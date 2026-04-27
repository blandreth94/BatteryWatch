import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import type { HeaterSession } from '../types'

export function useActiveHeaterSessions(): HeaterSession[] {
  const all = useLiveQuery(() => db.heaterSessions.toArray(), [])
  return (all ?? []).filter((s) => s.removedAt === null)
}

export function useHeaterSessionHistory(batteryId: string): HeaterSession[] {
  return useLiveQuery(
    () => db.heaterSessions.where('batteryId').equals(batteryId).reverse().toArray(),
    [batteryId],
  ) ?? []
}

export async function placeOnHeater(
  batteryId: string,
  slotNumber: 1 | 2,
  forMatchNumber: number | null,
): Promise<void> {
  // Close existing session in this slot if any
  const existing = await db.heaterSessions.where('slotNumber').equals(slotNumber).toArray()
  const active = existing.find((s) => s.removedAt === null)
  if (active?.id !== undefined) {
    await db.heaterSessions.update(active.id, { removedAt: Date.now() })
  }
  await db.heaterSessions.add({
    batteryId,
    slotNumber,
    placedAt: Date.now(),
    removedAt: null,
    forMatchNumber,
  })
}

export async function removeFromHeater(session: HeaterSession): Promise<void> {
  if (session.id === undefined) return
  await db.heaterSessions.update(session.id, { removedAt: Date.now() })
}
