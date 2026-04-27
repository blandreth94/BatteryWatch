import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import type { ChargerSession } from '../types'

export const TOTAL_SLOTS = 9

// Returns only currently-active sessions (removedAt === null)
export function useActiveChargerSessions() {
  const sessions = useLiveQuery(
    () => db.chargerSessions.where('removedAt').equals(0).toArray(),
    [],
  )
  // Dexie cannot index null directly; we store null as 0 sentinel in queries
  // Actually use filter approach instead:
  return (sessions ?? []).filter((s) => s.removedAt === null)
}

export function useChargerSessionHistory(batteryId: string) {
  return useLiveQuery(
    () => db.chargerSessions.where('batteryId').equals(batteryId).reverse().toArray(),
    [batteryId],
  ) ?? []
}

export async function placeOnCharger(
  batteryId: string,
  slotNumber: number,
  voltage: number | null,
  resistance: number | null,
): Promise<void> {
  // Close any existing active session for this slot
  const existing = await db.chargerSessions
    .where('slotNumber').equals(slotNumber)
    .toArray()
  const active = existing.find((s) => s.removedAt === null)
  if (active?.id !== undefined) {
    await db.chargerSessions.update(active.id, { removedAt: Date.now() })
  }

  await db.chargerSessions.add({
    batteryId,
    slotNumber,
    placedAt: Date.now(),
    removedAt: null,
    voltageAtPlacement: voltage,
    voltageAtRemoval: null,
    resistanceAtPlacement: resistance,
    isFullCycle: false,
  })
}

export async function removeFromCharger(
  session: ChargerSession,
  voltage: number | null,
  isFullCycle: boolean,
): Promise<void> {
  if (session.id === undefined) return
  await db.chargerSessions.update(session.id, {
    removedAt: Date.now(),
    voltageAtRemoval: voltage,
    isFullCycle,
  })
  if (isFullCycle) {
    const battery = await db.batteries.get(session.batteryId)
    if (battery) {
      await db.batteries.update(session.batteryId, { cycleCount: battery.cycleCount + 1 })
    }
  }
}

export function useAllActiveChargerSessions() {
  const all = useLiveQuery(() => db.chargerSessions.toArray(), [])
  return (all ?? []).filter((s) => s.removedAt === null)
}
