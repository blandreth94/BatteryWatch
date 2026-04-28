import type {
  AppSettings,
  Battery,
  BatteryStatus,
  BatteryUsageEvent,
  ChargerSession,
  HeaterSession,
  HeaterSlotSuggestion,
  MatchBatterySuggestion,
  MatchRecord,
} from '../types'

export function buildBatteryStatuses(
  batteries: Battery[],
  activeChargerSessions: ChargerSession[],
  activeHeaterSessions: HeaterSession[],
  activeUsageEvents: BatteryUsageEvent[],
): BatteryStatus[] {
  return batteries.map((battery) => {
    const charger = activeChargerSessions.find((s) => s.batteryId === battery.id)
    if (charger) return { battery, location: 'charger', chargerSlot: charger.slotNumber, chargerPlacedAt: charger.placedAt }

    const heater = activeHeaterSessions.find((s) => s.batteryId === battery.id)
    if (heater) return { battery, location: 'heater', heaterSlot: heater.slotNumber, heaterPlacedAt: heater.placedAt }

    const inUse = activeUsageEvents.find((e) => e.batteryId === battery.id)
    if (inUse) return { battery, location: 'in-use' }

    return { battery, location: 'pit' }
  })
}

const MIN_CHARGE_MS = 60 * 60_000 // batteries must have charged >= 1 hour to be heater-eligible

function selectHeaterCandidates(
  statuses: BatteryStatus[],
  lastUsedMap: Map<string, number>,
  now: number,
): BatteryStatus[] {
  // Primary: charger batteries that have been charging for at least 1 hour,
  // sorted by longest charging time first (oldest placedAt = most charged)
  const chargerReady = statuses
    .filter((s) => s.location === 'charger' && s.chargerPlacedAt !== undefined && now - s.chargerPlacedAt >= MIN_CHARGE_MS)
    .sort((a, b) => (a.chargerPlacedAt ?? now) - (b.chargerPlacedAt ?? now)) // oldest first = longest on charger

  // Fallback: pit batteries (already removed from charger), sorted by most rested
  const pitReady = statuses
    .filter((s) => s.location === 'pit')
    .sort((a, b) => {
      const aLastUsed = lastUsedMap.get(a.battery.id)
      const bLastUsed = lastUsedMap.get(b.battery.id)
      if (!aLastUsed && !bLastUsed) return a.battery.cycleCount - b.battery.cycleCount
      if (!aLastUsed) return 1
      if (!bLastUsed) return -1
      if (aLastUsed !== bLastUsed) return aLastUsed - bLastUsed // older last-use = more rest = comes first
      return a.battery.cycleCount - b.battery.cycleCount
    })

  return [...chargerReady, ...pitReady].slice(0, 2)
}

export function computeHeaterSuggestions(
  upcomingMatches: MatchRecord[],
  statuses: BatteryStatus[],
  activeHeaterSessions: HeaterSession[],
  lastUsedMap: Map<string, number>,
  settings: AppSettings,
  now: number,
): HeaterSlotSuggestion[] {
  const idle = (slotNumber: 1 | 2): HeaterSlotSuggestion => ({
    slotNumber, batteryId: null, action: 'idle',
    minutesUntilPlace: null, minutesWarm: null, placedAt: null,
    forMatchNumber: null, minutesUntilDeadline: null,
  })

  const upcoming = upcomingMatches
    .filter((m) => m.status === 'upcoming')
    .sort((a, b) => a.scheduledTime - b.scheduledTime)

  const nextMatch = upcoming[0]
  if (!nextMatch) return [idle(1), idle(2)]

  // Slot 1 warms for the next match, slot 2 warms for the match after that
  const matchForSlot: [MatchRecord, MatchRecord] = [nextMatch, upcoming[1] ?? nextMatch]

  const candidates = selectHeaterCandidates(statuses, lastUsedMap, now)

  return ([1, 2] as const).map((slot, i): HeaterSlotSuggestion => {
    const activeSession = activeHeaterSessions.find((s) => s.slotNumber === slot)
    const targetMatch = matchForSlot[i]

    const heaterDeadlineMs = targetMatch.scheduledTime - settings.walkAndQueueMinutes * 60_000
    const targetPlacementMs = heaterDeadlineMs - settings.heaterWarmMinutes * 60_000
    const minutesUntilDeadline = Math.round((heaterDeadlineMs - now) / 60_000)

    if (activeSession) {
      const minutesWarm = Math.floor((now - activeSession.placedAt) / 60_000)
      const isReady = minutesWarm >= settings.heaterWarmMinutes
      return {
        slotNumber: slot,
        batteryId: activeSession.batteryId,
        action: isReady ? 'ready' : 'occupied_not_ready',
        minutesUntilPlace: null,
        minutesWarm,
        placedAt: activeSession.placedAt,
        forMatchNumber: activeSession.forMatchNumber ?? targetMatch.matchNumber,
        minutesUntilDeadline,
      }
    }

    const candidate = candidates[i]
    if (!candidate) {
      return {
        slotNumber: slot, batteryId: null, action: 'idle',
        minutesUntilPlace: null, minutesWarm: null, placedAt: null,
        forMatchNumber: targetMatch.matchNumber, minutesUntilDeadline,
      }
    }

    const minutesUntilPlace = Math.round((targetPlacementMs - now) / 60_000)
    return {
      slotNumber: slot,
      batteryId: candidate.battery.id,
      action: minutesUntilPlace <= 0 ? 'place_now' : 'place_in',
      minutesUntilPlace: minutesUntilPlace > 0 ? minutesUntilPlace : null,
      minutesWarm: null,
      placedAt: null,
      forMatchNumber: targetMatch.matchNumber,
      minutesUntilDeadline,
    }
  })
}

export function rankBatteriesForNextMatch(
  statuses: BatteryStatus[],
  activeHeaterSessions: HeaterSession[],
  lastUsedMap: Map<string, number>,
  settings: AppSettings,
  now: number,
): MatchBatterySuggestion[] {
  const eligible = statuses.filter((s) => s.location === 'heater' || s.location === 'pit')

  return eligible
    .map((s): MatchBatterySuggestion => {
      const heaterSession = activeHeaterSessions.find((h) => h.batteryId === s.battery.id)
      const minutesOnHeater = heaterSession
        ? Math.floor((now - heaterSession.placedAt) / 60_000)
        : null
      const isWarm = minutesOnHeater !== null && minutesOnHeater >= settings.heaterWarmMinutes

      const lastUsed = lastUsedMap.get(s.battery.id)
      const restMinutes = lastUsed ? Math.floor((now - lastUsed) / 60_000) : null

      let score = 0
      if (!isWarm) score += 1000
      // More rest = better (lower score) — only applies if battery has been used
      if (restMinutes !== null) score -= restMinutes
      score += s.battery.cycleCount

      const reasons: string[] = []
      if (isWarm && minutesOnHeater !== null) reasons.push(`${minutesOnHeater}min on heater`)
      if (restMinutes !== null && restMinutes > 0) reasons.push(`${restMinutes}min rest`)
      else if (!lastUsed) reasons.push('never used')
      reasons.push(`${s.battery.cycleCount} cycles`)

      return { batteryId: s.battery.id, reason: reasons.join(' · '), score, isWarm, minutesOnHeater }
    })
    .sort((a, b) => a.score - b.score)
}
