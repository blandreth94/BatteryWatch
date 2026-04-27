import Dexie, { type EntityTable } from 'dexie'
import type { Battery, ChargerSession, HeaterSession, MatchRecord, AppSettings } from '../types'

class BatteryWatchDB extends Dexie {
  batteries!: EntityTable<Battery, 'id'>
  chargerSessions!: EntityTable<ChargerSession, 'id'>
  heaterSessions!: EntityTable<HeaterSession, 'id'>
  matchRecords!: EntityTable<MatchRecord, 'id'>
  settings!: EntityTable<AppSettings, 'key'>

  constructor() {
    super('BatteryWatchDB')
    this.version(1).stores({
      batteries: '&id, year, cycleCount, createdAt',
      chargerSessions: '++id, batteryId, slotNumber, placedAt, removedAt',
      heaterSessions: '++id, batteryId, slotNumber, placedAt, removedAt',
      matchRecords: '++id, matchNumber, batteryId, status, scheduledTime',
      settings: '&key',
    })
  }
}

export const db = new BatteryWatchDB()
