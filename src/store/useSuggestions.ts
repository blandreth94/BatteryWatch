import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import { buildBatteryStatuses, computeHeaterSuggestions, rankBatteriesForNextMatch } from '../engine/suggestions'
import { buildLastUsedMap } from './useUsageEvents'
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
  const allUsageEvents = useLiveQuery(() => db.usageEvents.toArray(), []) ?? []
  const upcomingMatches = useLiveQuery(
    () => db.matchRecords.where('status').equals('upcoming').sortBy('scheduledTime'),
    [],
  ) ?? []

  const activeHeaterSessions = allHeaterSessions.filter((s) => s.removedAt === null)
  const activeChargerSessions = allChargerSessions.filter((s) => s.removedAt === null)
  const activeUsageEvents = allUsageEvents.filter((e) => e.returnedAt === null)

  // Build last-used timestamps from actual usage events (not heater removals)
  const lastUsedMap = buildLastUsedMap(allUsageEvents)

  const statuses = buildBatteryStatuses(batteries, activeChargerSessions, activeHeaterSessions, activeUsageEvents)

  const heaterSuggestions = computeHeaterSuggestions(
    upcomingMatches, statuses, activeHeaterSessions, lastUsedMap, settings, now,
  )

  const matchSuggestions = rankBatteriesForNextMatch(
    statuses, activeHeaterSessions, lastUsedMap, settings, now,
  )

  return { heaterSuggestions, matchSuggestions }
}
