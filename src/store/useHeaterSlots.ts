import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import { isBatteryAvailable } from './useUsageEvents'
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
  const availability = await isBatteryAvailable(batteryId)
  if (!availability.available) return { ok: false, error: availability.reason }

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

export async function removeFromHeater(session: HeaterSession): Promise<void> {
  if (session.id === undefined) return
  await db.heaterSessions.update(session.id, { removedAt: Date.now() })
  if (session.syncId) await enqueueSync('heaterSessions', session.syncId)
  flushSync()
}
