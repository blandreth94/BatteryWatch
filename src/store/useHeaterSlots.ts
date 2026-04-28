import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import { enqueueSync, flushSync } from '../sync/syncEngine'
import { generateId } from '../utils/uuid'
import type { HeaterSession } from '../types'

export function useActiveHeaterSessions(): HeaterSession[] {
  const all = useLiveQuery(() => db.heaterSessions.toArray(), []) ?? []
  return all.filter((s) => s.removedAt === null)
}

export function useHeaterSessionHistory(batteryId: string): HeaterSession[] {
  return useLiveQuery(
    () => db.heaterSessions.where('batteryId').equals(batteryId).reverse().sortBy('placedAt'),
    [batteryId],
  ) ?? []
}

export async function placeOnHeater(
  batteryId: string,
  slotNumber: 1 | 2,
  forMatchNumber: number | null,
  movedBy?: string,
): Promise<{ ok: boolean; error?: string }> {
  // Block if already on heater or currently in use — but NOT if on charger.
  // Placing on heater implicitly removes from charger (same pattern as
  // placeOnCharger auto-closing open usage events).
  const [onHeater, inUse] = await Promise.all([
    db.heaterSessions.where('batteryId').equals(batteryId).toArray()
      .then((rows) => rows.find((r) => r.removedAt === null)),
    db.usageEvents.where('batteryId').equals(batteryId).toArray()
      .then((rows) => rows.find((r) => r.returnedAt === null)),
  ])
  if (onHeater) return { ok: false, error: `${batteryId} is already on heater ${onHeater.slotNumber}` }
  if (inUse) return { ok: false, error: `${batteryId} is currently ${inUse.eventType === 'match' ? `in match ${inUse.matchNumber}` : 'at practice field'}` }

  // Auto-close any active charger session
  const onCharger = await db.chargerSessions.where('batteryId').equals(batteryId).toArray()
    .then((rows) => rows.find((r) => r.removedAt === null))
  if (onCharger?.id !== undefined) {
    await db.chargerSessions.update(onCharger.id, { removedAt: Date.now() })
    if (onCharger.syncId) await enqueueSync('chargerSessions', onCharger.syncId)
  }

  // Close existing session in this slot if any
  const existing = await db.heaterSessions.where('slotNumber').equals(slotNumber).toArray()
  const active = existing.find((s) => s.removedAt === null)
  if (active?.id !== undefined) {
    await db.heaterSessions.update(active.id, { removedAt: Date.now() })
    if (active.syncId) await enqueueSync('heaterSessions', active.syncId)
  }

  const syncId = generateId()
  await db.heaterSessions.add({
    syncId, batteryId, slotNumber,
    placedAt: Date.now(), removedAt: null,
    forMatchNumber,
    ...(movedBy ? { movedBy } : {}),
  })
  await enqueueSync('heaterSessions', syncId)
  flushSync()
  return { ok: true }
}

export async function removeFromHeater(
  session: HeaterSession,
  removedBy?: string,
  voltageAtRemoval?: number | null,
): Promise<void> {
  if (session.id === undefined) return
  await db.heaterSessions.update(session.id, {
    removedAt: Date.now(),
    ...(removedBy ? { removedBy } : {}),
    ...(voltageAtRemoval !== undefined ? { voltageAtRemoval } : {}),
  })
  if (session.syncId) await enqueueSync('heaterSessions', session.syncId)
  flushSync()
}
