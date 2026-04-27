import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import type { MatchRecord } from '../types'

export function useMatchSchedule(): MatchRecord[] {
  return useLiveQuery(
    () => db.matchRecords.orderBy('scheduledTime').toArray(),
    [],
  ) ?? []
}

export function useUpcomingMatches(): MatchRecord[] {
  return useLiveQuery(
    () => db.matchRecords.where('status').equals('upcoming').sortBy('scheduledTime'),
    [],
  ) ?? []
}

export async function addMatch(matchNumber: number, scheduledTime: number): Promise<void> {
  await db.matchRecords.add({
    matchNumber,
    scheduledTime,
    batteryId: null,
    completedAt: null,
    status: 'upcoming',
  })
}

export async function assignBatteryToMatch(matchId: number, batteryId: string | null): Promise<void> {
  await db.matchRecords.update(matchId, { batteryId })
}

export async function startMatch(matchId: number): Promise<void> {
  await db.matchRecords.update(matchId, { status: 'active' })
}

export async function completeMatch(matchId: number): Promise<void> {
  await db.matchRecords.update(matchId, {
    status: 'complete',
    completedAt: Date.now(),
  })
}

export async function deleteMatch(matchId: number): Promise<void> {
  await db.matchRecords.delete(matchId)
}

export async function importFromTBA(eventKey: string, apiKey: string, teamNumber = 401): Promise<number> {
  const url = `https://www.thebluealliance.com/api/v3/event/${eventKey}/matches/simple`
  const res = await fetch(url, { headers: { 'X-TBA-Auth-Key': apiKey } })
  if (!res.ok) throw new Error(`TBA API error: ${res.status}`)

  const data = await res.json() as TBAMatch[]
  const team = `frc${teamNumber}`

  const ourMatches = data
    .filter((m) => m.alliances.red.team_keys.includes(team) || m.alliances.blue.team_keys.includes(team))
    .filter((m) => m.comp_level === 'qm' || m.comp_level === 'sf' || m.comp_level === 'f')
    .sort((a, b) => a.time - b.time)

  await db.transaction('rw', db.matchRecords, async () => {
    // Clear existing upcoming matches
    await db.matchRecords.where('status').equals('upcoming').delete()
    for (const m of ourMatches) {
      await db.matchRecords.add({
        matchNumber: m.match_number,
        scheduledTime: m.predicted_time ? m.predicted_time * 1000 : m.time * 1000,
        batteryId: null,
        completedAt: null,
        status: 'upcoming',
      })
    }
  })

  return ourMatches.length
}

// Minimal TBA API shape
interface TBAMatch {
  match_number: number
  comp_level: string
  time: number
  predicted_time: number | null
  alliances: {
    red: { team_keys: string[] }
    blue: { team_keys: string[] }
  }
}
