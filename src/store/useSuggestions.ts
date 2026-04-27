import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import { buildBatteryStatuses, computeHeaterSuggestions, rankBatteriesForNextMatch } from '../engine/suggestions'
import { useSettings } from './useSettings'
import type { HeaterSlotSuggestion, MatchBatterySuggestion } from '../types'

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function useSuggestions(): {
  heaterSuggestions: HeaterSlotSuggestion[]
  matchSuggestions: MatchBatterySuggestion[]
} {
  const now = useNow()
  const settings = useSettings()

  const batteries = useLiveQuery(() => db.batteries.toArray(), []) ?? []
  const allHeaterSessions = useLiveQuery(() => db.heaterSessions.toArray(), []) ?? []
  const allChargerSessions = useLiveQuery(() => db.chargerSessions.toArray(), []) ?? []
  const upcomingMatches = useLiveQuery(
    () => db.matchRecords.where('status').equals('upcoming').sortBy('scheduledTime'),
    [],
  ) ?? []
  const activeMatch = useLiveQuery(
    () => db.matchRecords.where('status').equals('active').first(),
    [],
  )

  const activeHeaterSessions = allHeaterSessions.filter((s) => s.removedAt === null)
  const activeChargerSessions = allChargerSessions.filter((s) => s.removedAt === null)
  const activeMatchBatteryId = activeMatch?.batteryId ?? null

  // Build a map of batteryId → timestamp of last completed match
  const lastMatchTimestamps = new Map<string, number>()
  for (const s of allHeaterSessions) {
    if (s.removedAt !== null) {
      const existing = lastMatchTimestamps.get(s.batteryId) ?? 0
      if (s.removedAt > existing) lastMatchTimestamps.set(s.batteryId, s.removedAt)
    }
  }

  const statuses = buildBatteryStatuses(batteries, activeChargerSessions, activeHeaterSessions, activeMatchBatteryId)

  const heaterSuggestions = computeHeaterSuggestions(
    upcomingMatches,
    statuses,
    activeHeaterSessions,
    lastMatchTimestamps,
    settings,
    now,
  )

  const matchSuggestions = rankBatteriesForNextMatch(
    statuses,
    activeHeaterSessions,
    lastMatchTimestamps,
    settings,
    now,
  )

  return { heaterSuggestions, matchSuggestions }
}
