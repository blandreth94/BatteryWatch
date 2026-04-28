import Dexie, { type EntityTable, type Table } from 'dexie'
import type { Battery, ChargerSession, HeaterSession, BatteryUsageEvent, MatchRecord, AppSettings, PendingSync } from '../types'

class BatteryWatchDB extends Dexie {
  batteries!: EntityTable<Battery, 'id'>
  chargerSessions!: EntityTable<ChargerSession, 'id'>
  heaterSessions!: EntityTable<HeaterSession, 'id'>
  usageEvents!: EntityTable<BatteryUsageEvent, 'id'>
  matchRecords!: EntityTable<MatchRecord, 'id'>
  settings!: EntityTable<AppSettings, 'key'>
  pendingSync!: Table<PendingSync>

  constructor() {
    super('BatteryWatchDB')
    this.version(1).stores({
      batteries: '&id, year, cycleCount, createdAt',
      chargerSessions: '++id, batteryId, slotNumber, placedAt, removedAt',
      heaterSessions: '++id, batteryId, slotNumber, placedAt, removedAt',
      matchRecords: '++id, matchNumber, batteryId, status, scheduledTime',
      settings: '&key',
    })
    this.version(2).stores({
      batteries: '&id, year, cycleCount, createdAt',
      chargerSessions: '++id, batteryId, slotNumber, placedAt, removedAt',
      heaterSessions: '++id, batteryId, slotNumber, placedAt, removedAt',
      usageEvents: '++id, batteryId, eventType, matchNumber, takenAt, returnedAt',
      matchRecords: '++id, matchNumber, batteryId, status, scheduledTime',
      settings: '&key',
    })
    this.version(3)
      .stores({
        batteries: '&id, year, cycleCount, createdAt',
        chargerSessions: '++id, syncId, batteryId, slotNumber, placedAt, removedAt',
        heaterSessions: '++id, syncId, batteryId, slotNumber, placedAt, removedAt',
        usageEvents: '++id, syncId, batteryId, eventType, matchNumber, takenAt, returnedAt',
        matchRecords: '++id, syncId, matchNumber, batteryId, status, scheduledTime',
        settings: '&key',
        // Compound primary key deduplicates pending operations for the same record
        pendingSync: '&[table+syncId], queuedAt',
      })
      .upgrade(async (tx) => {
        // Assign syncIds to all existing records that predate cloud sync
        for (const tableName of ['chargerSessions', 'heaterSessions', 'usageEvents', 'matchRecords']) {
          await tx.table(tableName).toCollection().modify((record: Record<string, unknown>) => {
            if (!record.syncId) record.syncId = crypto.randomUUID()
          })
        }
      })
  }
}

export const db = new BatteryWatchDB()
