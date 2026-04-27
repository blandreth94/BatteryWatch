import type {
  AppSettings,
  Battery,
  BatteryStatus,
  ChargerSession,
  HeaterSession,
  HeaterSlotSuggestion,
  MatchBatterySuggestion,
  MatchRecord,
} from '../types'

// Derive the current location/status of every battery.
export function buildBatteryStatuses(
  batteries: Battery[],
  activeChargerSessions: ChargerSession[],
  activeHeaterSessions: HeaterSession[],
  activeMatchBatteryId: string | null,
): BatteryStatus[] {
  return batteries.map((battery) => {
    const charger = activeChargerSessions.find((s) => s.batteryId === battery.id)
    if (charger) {
      return { battery, location: 'charger', chargerSlot: charger.slotNumber }
    }
    const heater = activeHeaterSessions.find((s) => s.batteryId === battery.id)
    if (heater) {
      return {
        battery,
        location: 'heater',
        heaterSlot: heater.slotNumber,
        heaterPlacedAt: heater.placedAt,
      }
    }
    if (battery.id === activeMatchBatteryId) {
      return { battery, location: 'match' }
    }
    return { battery, location: 'pit' }
  })
}

// Select the 2 best candidates to place on heaters (most rested, fully available).
function selectHeaterCandidates(
  statuses: BatteryStatus[],
  lastMatchTimestamps: Map<string, number>,
  now: number,
): BatteryStatus[] {
  const eligible = statuses.filter((s) => s.location === 'pit' || s.location === 'heater')

  return eligible
    .slice()
    .sort((a, b) => {
      const aRest = now - (lastMatchTimestamps.get(a.battery.id) ?? 0)
      const bRest = now - (lastMatchTimestamps.get(b.battery.id) ?? 0)
      // Most rested first
      if (bRest !== aRest) return bRest - aRest
      // Tiebreak: lower cycle count
      return a.battery.cycleCount - b.battery.cycleCount
    })
    .slice(0, 2)
}

/**
 * Compute the suggestion state for both heater slots given current app state.
 * Pure function — no DB calls, no React hooks.
 */
export function computeHeaterSuggestions(
  upcomingMatches: MatchRecord[],
  statuses: BatteryStatus[],
  activeHeaterSessions: HeaterSession[],
  lastMatchTimestamps: Map<string, number>,
  settings: AppSettings,
  now: number,
): HeaterSlotSuggestion[] {
  const nextMatch = upcomingMatches
    .filter((m) => m.status === 'upcoming')
    .sort((a, b) => a.scheduledTime - b.scheduledTime)[0]

  const results: HeaterSlotSuggestion[] = [
    { slotNumber: 1, batteryId: null, action: 'idle', minutesUntilPlace: null, minutesWarm: null, forMatchNumber: null, minutesUntilDeadline: null },
    { slotNumber: 2, batteryId: null, action: 'idle', minutesUntilPlace: null, minutesWarm: null, forMatchNumber: null, minutesUntilDeadline: null },
  ]

  if (!nextMatch) return results

  const heaterDeadlineMs = nextMatch.scheduledTime - settings.walkAndQueueMinutes * 60_000
  const targetPlacementMs = heaterDeadlineMs - settings.heaterWarmMinutes * 60_000
  const minutesUntilDeadline = Math.round((heaterDeadlineMs - now) / 60_000)

  const candidates = selectHeaterCandidates(statuses, lastMatchTimestamps, now)

  for (let i = 0; i < 2; i++) {
    const slot = (i + 1) as 1 | 2
    const activeSession = activeHeaterSessions.find((s) => s.slotNumber === slot)

    if (activeSession) {
      const minutesWarm = Math.floor((now - activeSession.placedAt) / 60_000)
      const isReady = minutesWarm >= settings.heaterWarmMinutes
      results[i] = {
        slotNumber: slot,
        batteryId: activeSession.batteryId,
        action: isReady ? 'ready' : 'occupied_not_ready',
        minutesUntilPlace: null,
        minutesWarm,
        forMatchNumber: nextMatch.matchNumber,
        minutesUntilDeadline,
      }
    } else {
      const candidate = candidates[i]
      if (!candidate) {
        results[i] = { slotNumber: slot, batteryId: null, action: 'idle', minutesUntilPlace: null, minutesWarm: null, forMatchNumber: nextMatch.matchNumber, minutesUntilDeadline }
        continue
      }
      const minutesUntilPlace = Math.round((targetPlacementMs - now) / 60_000)
      results[i] = {
        slotNumber: slot,
        batteryId: candidate.battery.id,
        action: minutesUntilPlace <= 0 ? 'place_now' : 'place_in',
        minutesUntilPlace: minutesUntilPlace > 0 ? minutesUntilPlace : null,
        minutesWarm: null,
        forMatchNumber: nextMatch.matchNumber,
        minutesUntilDeadline,
      }
    }
  }

  return results
}

/**
 * Rank available batteries for the next match.
 * Prefers warm batteries first, then most rested, then lowest cycle count.
 * Pure function — no DB calls, no React hooks.
 */
export function rankBatteriesForNextMatch(
  statuses: BatteryStatus[],
  activeHeaterSessions: HeaterSession[],
  lastMatchTimestamps: Map<string, number>,
  settings: AppSettings,
  now: number,
): MatchBatterySuggestion[] {
  const eligible = statuses.filter(
    (s) => s.location === 'heater' || s.location === 'pit',
  )

  return eligible
    .map((s): MatchBatterySuggestion => {
      const heaterSession = activeHeaterSessions.find((h) => h.batteryId === s.battery.id)
      const minutesOnHeater = heaterSession
        ? Math.floor((now - heaterSession.placedAt) / 60_000)
        : null
      const isWarm = minutesOnHeater !== null && minutesOnHeater >= settings.heaterWarmMinutes
      const restMs = now - (lastMatchTimestamps.get(s.battery.id) ?? 0)
      const restMinutes = Math.floor(restMs / 60_000)

      let score = 0
      if (!isWarm) score += 1000     // heavily prefer warm batteries
      score -= restMinutes           // more rest = lower (better) score
      score += s.battery.cycleCount  // fewer cycles = lower (better) score
      if (s.battery.internalResistance !== null && s.battery.internalResistance > settings.resistanceWarningThreshold) {
        score += 500                 // penalise degraded batteries
      }

      const reasons: string[] = []
      if (isWarm) reasons.push(`${minutesOnHeater}min on heater`)
      if (restMinutes > 0) reasons.push(`${restMinutes}min rest`)
      reasons.push(`${s.battery.cycleCount} cycles`)

      return {
        batteryId: s.battery.id,
        reason: reasons.join(' · '),
        score,
        isWarm,
        minutesOnHeater,
      }
    })
    .sort((a, b) => a.score - b.score)
}
