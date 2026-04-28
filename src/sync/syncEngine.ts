import { db } from '../db/schema'
import { getSupabase, isSupabaseConfigured } from './supabaseClient'
import { ENV_STORAGE_MODE, ENV_TEAM_NUMBER } from '../env'
import type { Battery, ChargerSession, HeaterSession, BatteryUsageEvent, MatchRecord, AppSettings, PendingSync } from '../types'
import { DEFAULT_SETTINGS } from '../types'

// ── Table name mapping (Dexie camelCase → Supabase snake_case) ────────────────

export type SyncableTable =
  | 'batteries'
  | 'chargerSessions'
  | 'heaterSessions'
  | 'usageEvents'
  | 'matchRecords'
  | 'settings'

const SB_TABLE: Record<SyncableTable, string> = {
  batteries: 'batteries',
  chargerSessions: 'charger_sessions',
  heaterSessions: 'heater_sessions',
  usageEvents: 'usage_events',
  matchRecords: 'match_records',
  settings: 'app_settings',
}

// ── Mode ──────────────────────────────────────────────────────────────────────

export function isCloudModeLocked(): boolean {
  return ENV_STORAGE_MODE === 'cloud' || ENV_STORAGE_MODE === 'local'
}

export function isCloudMode(): boolean {
  if (!isSupabaseConfigured()) return false
  if (ENV_STORAGE_MODE === 'cloud') return true
  if (ENV_STORAGE_MODE === 'local') return false
  return localStorage.getItem('storageMode') !== 'local'
}

export function setStorageMode(mode: 'cloud' | 'local'): void {
  localStorage.setItem('storageMode', mode)
}

// ── Sync status ───────────────────────────────────────────────────────────────

export interface SyncStatus {
  pending: number
  lastSyncedAt: number | null
  syncing: boolean
  error: string | null
}

let _status: SyncStatus = { pending: 0, lastSyncedAt: null, syncing: false, error: null }
const _listeners = new Set<() => void>()

function _notify() { _listeners.forEach((fn) => fn()) }

export function subscribeSyncStatus(fn: () => void): () => void {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

export function getSyncStatus(): SyncStatus { return { ..._status } }

// ── Enqueue ───────────────────────────────────────────────────────────────────

export async function enqueueSync(
  table: SyncableTable,
  syncId: string,
  operation: 'upsert' | 'delete' = 'upsert',
): Promise<void> {
  if (!isCloudMode()) return
  // Compound primary key auto-deduplicates: put() replaces any existing entry
  // for the same (table, syncId) pair, updating to the latest operation.
  await db.pendingSync.put({ table, syncId, operation, queuedAt: Date.now() })
  _status = { ..._status, pending: await db.pendingSync.count() }
  _notify()
}

// ── Flush ─────────────────────────────────────────────────────────────────────

let _flushTimer: ReturnType<typeof setTimeout> | null = null

export function flushSync(): void {
  if (!isCloudMode() || _flushTimer) return
  _flushTimer = setTimeout(async () => {
    _flushTimer = null
    await _doFlush()
  }, 500)
}

// Direct flush for the manual "Push to cloud" button — skips debounce.
// Returns true if anything was pushed, false if queue was already empty.
export async function pushToCloud(): Promise<boolean> {
  const pending = await db.pendingSync.count()
  if (pending === 0) return false
  await _doFlush()
  return true
}

// Re-enqueues every local record and flushes. Use this as a "repair sync"
// operation when records were created before cloud sync was configured, or to
// recover from a partial push. Safe to call multiple times — enqueueSync
// deduplicates by (table, syncId).
export async function pushAllLocalToCloud(): Promise<void> {
  if (!isCloudMode()) return
  const batteries = await db.batteries.toArray()
  for (const b of batteries) await enqueueSync('batteries', b.id)
  const cs = await db.chargerSessions.toArray()
  for (const s of cs) if (s.syncId) await enqueueSync('chargerSessions', s.syncId)
  const hs = await db.heaterSessions.toArray()
  for (const s of hs) if (s.syncId) await enqueueSync('heaterSessions', s.syncId)
  const ue = await db.usageEvents.toArray()
  for (const e of ue) if (e.syncId) await enqueueSync('usageEvents', e.syncId)
  const mr = await db.matchRecords.toArray()
  for (const r of mr) if (r.syncId) await enqueueSync('matchRecords', r.syncId)
  const settings = await db.settings.get('settings')
  if (settings) await enqueueSync('settings', String(settings.teamNumber))
  await _doFlush()
}

async function _doFlush(): Promise<void> {
  if (!navigator.onLine) return
  const supabase = getSupabase()
  if (!supabase) return

  const pending = await db.pendingSync.orderBy('queuedAt').toArray()
  if (pending.length === 0) return

  _status = { ..._status, syncing: true, error: null }
  _notify()

  let failed = 0
  for (const item of pending) {
    try {
      await _syncItem(item)
      await db.pendingSync.delete([item.table, item.syncId])
    } catch {
      failed++
    }
  }

  const remaining = await db.pendingSync.count()
  _status = {
    pending: remaining,
    lastSyncedAt: remaining === 0 ? Date.now() : _status.lastSyncedAt,
    syncing: false,
    error: failed > 0 ? `${failed} item(s) failed — will retry` : null,
  }
  _notify()
}

async function _syncItem(item: PendingSync): Promise<void> {
  const supabase = getSupabase()!
  const sbTable = SB_TABLE[item.table as SyncableTable]

  if (item.operation === 'delete') {
    const { error } = await supabase.from(sbTable).delete().eq('sync_id', item.syncId)
    if (error) throw error
    return
  }

  const row = await _buildRow(item.table as SyncableTable, item.syncId)
  if (!row) return // record deleted locally before sync could run

  const { error } = await supabase.from(sbTable).upsert(row, { onConflict: 'sync_id' })
  if (error) throw error
}

// ── Row builders: Dexie record → Supabase row ─────────────────────────────────

const _tid = (): number => ENV_TEAM_NUMBER || 401

async function _buildRow(table: SyncableTable, syncId: string): Promise<Record<string, unknown> | null> {
  const tid = _tid()
  switch (table) {
    case 'batteries': {
      const r = await db.batteries.get(syncId) // battery syncId === battery id
      if (!r) return null
      return {
        sync_id: r.id, team_id: tid,
        id: r.id, year: r.year, label: r.label,
        cycle_count: r.cycleCount, internal_resistance: r.internalResistance,
        notes: r.notes, created_at: r.createdAt,
      }
    }
    case 'chargerSessions': {
      const r = await db.chargerSessions.where('syncId').equals(syncId).first()
      if (!r) return null
      return {
        sync_id: r.syncId, team_id: tid,
        battery_id: r.batteryId, slot_number: r.slotNumber,
        placed_at: r.placedAt, removed_at: r.removedAt,
        voltage_at_placement: r.voltageAtPlacement,
        voltage_at_removal: r.voltageAtRemoval,
        resistance_at_placement: r.resistanceAtPlacement,
        is_full_cycle: r.isFullCycle,
      }
    }
    case 'heaterSessions': {
      const r = await db.heaterSessions.where('syncId').equals(syncId).first()
      if (!r) return null
      return {
        sync_id: r.syncId, team_id: tid,
        battery_id: r.batteryId, slot_number: r.slotNumber,
        placed_at: r.placedAt, removed_at: r.removedAt,
        for_match_number: r.forMatchNumber,
        moved_by: r.movedBy ?? null,
        removed_by: r.removedBy ?? null,
        voltage_at_removal: r.voltageAtRemoval ?? null,
      }
    }
    case 'usageEvents': {
      const r = await db.usageEvents.where('syncId').equals(syncId).first()
      if (!r) return null
      return {
        sync_id: r.syncId, team_id: tid,
        battery_id: r.batteryId, event_type: r.eventType,
        match_number: r.matchNumber, taken_at: r.takenAt,
        returned_at: r.returnedAt, taken_by: r.takenBy,
        voltage_at_take: r.voltageAtTake,
        resistance_at_take: r.resistanceAtTake,
        from_location: r.fromLocation, from_slot: r.fromSlot,
        notes: r.notes,
      }
    }
    case 'matchRecords': {
      const r = await db.matchRecords.where('syncId').equals(syncId).first()
      if (!r) return null
      return {
        sync_id: r.syncId, team_id: tid,
        match_number: r.matchNumber, scheduled_time: r.scheduledTime,
        battery_id: r.batteryId, completed_at: r.completedAt,
        status: r.status,
      }
    }
    case 'settings': {
      const r = await db.settings.get('settings')
      if (!r) return null
      return {
        sync_id: String(tid), team_id: tid,
        event_name: r.eventName, team_number: r.teamNumber,
        season_year: r.seasonYear,
        heater_warm_minutes: r.heaterWarmMinutes,
        walk_and_queue_minutes: r.walkAndQueueMinutes,
        heater_slot_count: r.heaterSlotCount,
        tba_api_key: r.tbaApiKey, tba_event_key: r.tbaEventKey,
      }
    }
  }
}

// ── Row mappers: Supabase row → Dexie record ──────────────────────────────────
// Shared between pullFromSupabase (bulk) and _applyRealtimeEvent (single row).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _rowToBattery(r: any): Battery {
  return {
    id: r.id, year: r.year, label: r.label,
    cycleCount: r.cycle_count, internalResistance: r.internal_resistance,
    notes: r.notes, createdAt: r.created_at,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _rowToChargerSession(r: any): ChargerSession {
  return {
    syncId: r.sync_id, batteryId: r.battery_id, slotNumber: r.slot_number,
    placedAt: r.placed_at, removedAt: r.removed_at,
    voltageAtPlacement: r.voltage_at_placement,
    voltageAtRemoval: r.voltage_at_removal,
    resistanceAtPlacement: r.resistance_at_placement,
    isFullCycle: r.is_full_cycle,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _rowToHeaterSession(r: any): HeaterSession {
  return {
    syncId: r.sync_id, batteryId: r.battery_id, slotNumber: r.slot_number,
    placedAt: r.placed_at, removedAt: r.removed_at, forMatchNumber: r.for_match_number,
    movedBy: r.moved_by ?? undefined,
    removedBy: r.removed_by ?? undefined,
    voltageAtRemoval: r.voltage_at_removal ?? undefined,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _rowToUsageEvent(r: any): BatteryUsageEvent {
  return {
    syncId: r.sync_id, batteryId: r.battery_id, eventType: r.event_type,
    matchNumber: r.match_number, takenAt: r.taken_at, returnedAt: r.returned_at,
    takenBy: r.taken_by, voltageAtTake: r.voltage_at_take,
    resistanceAtTake: r.resistance_at_take, fromLocation: r.from_location,
    fromSlot: r.from_slot, notes: r.notes,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _rowToMatchRecord(r: any): MatchRecord {
  return {
    syncId: r.sync_id, matchNumber: r.match_number,
    scheduledTime: r.scheduled_time, batteryId: r.battery_id,
    completedAt: r.completed_at, status: r.status,
  }
}

// ── Apply a single realtime event to Dexie ────────────────────────────────────

async function _applyRealtimeEvent(
  sbTable: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventType: string, newRow: any, oldRow: any,
): Promise<void> {
  if (eventType === 'DELETE') {
    const syncId: string = oldRow.sync_id
    switch (sbTable) {
      case 'batteries':        await db.batteries.delete(syncId); break
      case 'charger_sessions': await db.chargerSessions.where('syncId').equals(syncId).delete(); break
      case 'heater_sessions':  await db.heaterSessions.where('syncId').equals(syncId).delete(); break
      case 'usage_events':     await db.usageEvents.where('syncId').equals(syncId).delete(); break
      case 'match_records':    await db.matchRecords.where('syncId').equals(syncId).delete(); break
      case 'app_settings':     await db.settings.delete('settings'); break
    }
    return
  }

  // INSERT or UPDATE — newRow contains the full row
  switch (sbTable) {
    case 'batteries':        await db.batteries.put(_rowToBattery(newRow)); break
    case 'charger_sessions': await _upsertBySyncId(db.chargerSessions, [_rowToChargerSession(newRow)]); break
    case 'heater_sessions':  await _upsertBySyncId(db.heaterSessions, [_rowToHeaterSession(newRow)]); break
    case 'usage_events':     await _upsertBySyncId(db.usageEvents, [_rowToUsageEvent(newRow)]); break
    case 'match_records':    await _upsertBySyncId(db.matchRecords, [_rowToMatchRecord(newRow)]); break
    case 'app_settings': {
      const existing = await db.settings.get('settings')
      await db.settings.put({
        ...(existing ?? DEFAULT_SETTINGS),
        key: 'settings',
        eventName: newRow.event_name, teamNumber: newRow.team_number,
        seasonYear: newRow.season_year, heaterWarmMinutes: newRow.heater_warm_minutes,
        walkAndQueueMinutes: newRow.walk_and_queue_minutes,
        heaterSlotCount: newRow.heater_slot_count ?? DEFAULT_SETTINGS.heaterSlotCount,
        tbaApiKey: newRow.tba_api_key, tbaEventKey: newRow.tba_event_key,
      } as AppSettings)
      break
    }
  }
}

// ── Pull from Supabase ────────────────────────────────────────────────────────

export async function pullFromSupabase(): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Supabase not configured')

  const tid = _tid()

  const [bRes, csRes, hsRes, ueRes, mrRes, sRes] = await Promise.all([
    supabase.from('batteries').select('*').eq('team_id', tid),
    supabase.from('charger_sessions').select('*').eq('team_id', tid),
    supabase.from('heater_sessions').select('*').eq('team_id', tid),
    supabase.from('usage_events').select('*').eq('team_id', tid),
    supabase.from('match_records').select('*').eq('team_id', tid),
    supabase.from('app_settings').select('*').eq('team_id', tid),
  ])

  for (const res of [bRes, csRes, hsRes, ueRes, mrRes, sRes]) {
    if (res.error) throw new Error(res.error.message)
  }

  await db.transaction(
    'rw',
    [db.batteries, db.chargerSessions, db.heaterSessions, db.usageEvents, db.matchRecords, db.settings],
    async () => {
      if (bRes.data?.length) await db.batteries.bulkPut(bRes.data.map(_rowToBattery))
      if (csRes.data?.length) await _upsertBySyncId(db.chargerSessions, csRes.data.map(_rowToChargerSession))
      if (hsRes.data?.length) await _upsertBySyncId(db.heaterSessions, hsRes.data.map(_rowToHeaterSession))
      if (ueRes.data?.length) await _upsertBySyncId(db.usageEvents, ueRes.data.map(_rowToUsageEvent))
      if (mrRes.data?.length) await _upsertBySyncId(db.matchRecords, mrRes.data.map(_rowToMatchRecord))

      if (sRes.data?.[0]) {
        const r = sRes.data[0]
        const existing = await db.settings.get('settings')
        await db.settings.put({
          ...(existing ?? DEFAULT_SETTINGS),
          key: 'settings',
          eventName: r.event_name, teamNumber: r.team_number,
          seasonYear: r.season_year, heaterWarmMinutes: r.heater_warm_minutes,
          walkAndQueueMinutes: r.walk_and_queue_minutes,
          heaterSlotCount: r.heater_slot_count ?? DEFAULT_SETTINGS.heaterSlotCount,
          tbaApiKey: r.tba_api_key, tbaEventKey: r.tba_event_key,
        } as AppSettings)
      }
    },
  )

  _status = { ..._status, lastSyncedAt: Date.now(), error: null }
  _notify()
}

// Upsert records into a Dexie table that uses ++id as PK, matching by syncId.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function _upsertBySyncId(table: any, records: Array<{ syncId?: string }>) {
  for (const record of records) {
    if (!record.syncId) continue
    const existing = await table.where('syncId').equals(record.syncId).first()
    if (existing?.id !== undefined) {
      await table.update(existing.id, record)
    } else {
      await table.add(record)
    }
  }
}

// ── Init (called once on app start) ──────────────────────────────────────────

export async function initSync(): Promise<void> {
  if (!isCloudMode()) return

  // Always pull on startup so every device gets current state immediately,
  // not just empty ones. Competition devices may have stale local state from
  // a previous session.
  try { await pullFromSupabase() } catch { /* silent — user can pull manually */ }

  // Flush any operations queued during a previous offline session
  flushSync()

  // Reconnect handler
  window.addEventListener('online', () => flushSync())

  // Pull when a PWA comes back to the foreground (phone lock/unlock, app switch)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isCloudMode()) {
      pullFromSupabase().catch(() => {})
    }
  })

  // Realtime: subscribe to row-level changes on all tables so every client
  // receives updates instantly (~100–200 ms) without polling
  const supabase = getSupabase()
  if (supabase) {
    const tid = _tid()
    const sbTables = ['batteries', 'charger_sessions', 'heater_sessions', 'usage_events', 'match_records', 'app_settings']
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = supabase.channel('bw-sync')
    for (const table of sbTables) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `team_id=eq.${tid}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          _applyRealtimeEvent(table, payload.eventType, payload.new, payload.old).catch(() => {})
        },
      )
    }
    channel.subscribe()
  }

  // Fallback full-pull every 5 min to catch any events missed during a
  // WebSocket reconnect gap
  setInterval(() => {
    if (isCloudMode()) pullFromSupabase().catch(() => {})
  }, 5 * 60_000)

  _status = { ..._status, pending: await db.pendingSync.count() }
  _notify()
}
