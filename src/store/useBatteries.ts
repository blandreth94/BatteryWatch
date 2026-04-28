import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import { enqueueSync, flushSync } from '../sync/syncEngine'
import type { Battery } from '../types'

export function useBatteries() {
  const batteries = useLiveQuery(() => db.batteries.orderBy('id').toArray(), [])
  return batteries ?? []
}

export async function addBattery(year: number, label: string): Promise<void> {
  const id = `${year}${label.toUpperCase()}`
  await db.batteries.add({
    id, year, label: label.toUpperCase(),
    cycleCount: 0, internalResistance: null, notes: '', createdAt: Date.now(),
  })
  await enqueueSync('batteries', id)
  flushSync()
}

export async function updateBattery(id: string, changes: Partial<Omit<Battery, 'id'>>): Promise<void> {
  await db.batteries.update(id, changes)
  await enqueueSync('batteries', id)
  flushSync()
}

export async function deleteBattery(id: string): Promise<void> {
  await db.transaction('rw', [db.batteries, db.chargerSessions, db.heaterSessions, db.matchRecords], async () => {
    await db.batteries.delete(id)
    await db.chargerSessions.where('batteryId').equals(id).delete()
    await db.heaterSessions.where('batteryId').equals(id).delete()
    await db.matchRecords.where('batteryId').equals(id).modify({ batteryId: null })
  })
  await enqueueSync('batteries', id, 'delete')
  flushSync()
}

export async function incrementCycleCount(batteryId: string): Promise<void> {
  const battery = await db.batteries.get(batteryId)
  if (battery) {
    await db.batteries.update(batteryId, { cycleCount: battery.cycleCount + 1 })
    await enqueueSync('batteries', batteryId)
    flushSync()
  }
}
