import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import type { BatteryUsageEvent } from '../types'

export function useUsageEvents(batteryId?: string): BatteryUsageEvent[] {
  return useLiveQuery(
    () => batteryId
      ? db.usageEvents.where('batteryId').equals(batteryId).reverse().sortBy('takenAt')
      : db.usageEvents.orderBy('takenAt').reverse().toArray(),
    [batteryId ?? ''],
  ) ?? []
}

export function useActiveUsageEvents(): BatteryUsageEvent[] {
  const all = useLiveQuery(() => db.usageEvents.toArray(), []) ?? []
  return all.filter((e) => e.returnedAt === null)
}

// Returns true if a battery is free to be placed somewhere new.
export async function isBatteryAvailable(batteryId: string): Promise<{ available: boolean; reason?: string }> {
  const [activeCharger, activeHeater, activeUsage] = await Promise.all([
    db.chargerSessions.where('batteryId').equals(batteryId).toArray()
      .then((rows) => rows.find((r) => r.removedAt === null)),
    db.heaterSessions.where('batteryId').equals(batteryId).toArray()
      .then((rows) => rows.find((r) => r.removedAt === null)),
    db.usageEvents.where('batteryId').equals(batteryId).toArray()
      .then((rows) => rows.find((r) => r.returnedAt === null)),
  ])
  if (activeCharger) return { available: false, reason: `${batteryId} is already on charger slot ${activeCharger.slotNumber}` }
  if (activeHeater) return { available: false, reason: `${batteryId} is already on heater ${activeHeater.slotNumber}` }
  if (activeUsage) return { available: false, reason: `${batteryId} is currently ${activeUsage.eventType === 'match' ? `in match ${activeUsage.matchNumber}` : 'at practice field'}` }
  return { available: true }
}

export async function recordUsageEvent(event: Omit<BatteryUsageEvent, 'id'>): Promise<void> {
  await db.usageEvents.add(event)
}

export async function returnBattery(eventId: number): Promise<void> {
  await db.usageEvents.update(eventId, { returnedAt: Date.now() })
}

// Build a map of batteryId → most recent takenAt for use by the suggestion engine.
export function buildLastUsedMap(events: BatteryUsageEvent[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const e of events) {
    const existing = map.get(e.batteryId) ?? 0
    if (e.takenAt > existing) map.set(e.batteryId, e.takenAt)
  }
  return map
}
