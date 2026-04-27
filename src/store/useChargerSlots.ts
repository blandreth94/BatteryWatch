import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import type { ChargerSession } from '../types'

export const TOTAL_SLOTS = 9

export function useAllActiveChargerSessions(): ChargerSession[] {
  const all = useLiveQuery(() => db.chargerSessions.toArray(), []) ?? []
  return all.filter((s) => s.removedAt === null)
}

export function useChargerSessionHistory(batteryId: string): ChargerSession[] {
  return useLiveQuery(
    () => db.chargerSessions.where('batteryId').equals(batteryId).reverse().sortBy('placedAt'),
    [batteryId],
  ) ?? []
}

export async function placeOnCharger(
  batteryId: string,
  slotNumber: number,
  voltage: number | null,
  resistance: number | null,
): Promise<{ ok: boolean; error?: string }> {
  // Block if the battery is already on a charger or heater — but NOT if it's
  // in an open usage event (match/practice). Placing on charger IS the return action.
  const [onCharger, onHeater] = await Promise.all([
    db.chargerSessions.where('batteryId').equals(batteryId).toArray()
      .then((rows) => rows.find((r) => r.removedAt === null)),
    db.heaterSessions.where('batteryId').equals(batteryId).toArray()
      .then((rows) => rows.find((r) => r.removedAt === null)),
  ])
  if (onCharger) return { ok: false, error: `${batteryId} is already on charger slot ${onCharger.slotNumber}` }
  if (onHeater) return { ok: false, error: `${batteryId} is already on heater ${onHeater.slotNumber}` }

  const now = Date.now()

  // Auto-close any open usage event — placing on charger implicitly returns the battery
  const openUsageEvent = await db.usageEvents.where('batteryId').equals(batteryId).toArray()
    .then((rows) => rows.find((r) => r.returnedAt === null))
  if (openUsageEvent?.id !== undefined) {
    await db.usageEvents.update(openUsageEvent.id, { returnedAt: now })
  }

  // Close any existing active session for this slot
  const existingSlot = await db.chargerSessions.where('slotNumber').equals(slotNumber).toArray()
  const activeSlot = existingSlot.find((s) => s.removedAt === null)
  if (activeSlot?.id !== undefined) {
    await db.chargerSessions.update(activeSlot.id, { removedAt: now })
  }

  await db.chargerSessions.add({
    batteryId, slotNumber,
    placedAt: now,
    removedAt: null,
    voltageAtPlacement: voltage,
    voltageAtRemoval: null,
    resistanceAtPlacement: resistance,
    isFullCycle: false,
  })
  return { ok: true }
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
