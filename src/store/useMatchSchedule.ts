import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import { enqueueSync, flushSync } from '../sync/syncEngine'
import { generateId } from '../utils/uuid'
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
  const syncId = generateId()
  await db.matchRecords.add({
    syncId, matchNumber, scheduledTime,
    batteryId: null, completedAt: null, status: 'upcoming', allianceColor: null,
  })
  await enqueueSync('matchRecords', syncId)
  flushSync()
}

export async function assignBatteryToMatch(matchId: number, batteryId: string | null): Promise<void> {
  await db.matchRecords.update(matchId, { batteryId })
  const r = await db.matchRecords.get(matchId)
  if (r?.syncId) { await enqueueSync('matchRecords', r.syncId); flushSync() }
}

export async function startMatch(matchId: number): Promise<void> {
  await db.matchRecords.update(matchId, { status: 'active' })
  const r = await db.matchRecords.get(matchId)
  if (r?.syncId) { await enqueueSync('matchRecords', r.syncId); flushSync() }
}

export async function completeMatch(matchId: number): Promise<void> {
  await db.matchRecords.update(matchId, { status: 'complete', completedAt: Date.now() })
  const r = await db.matchRecords.get(matchId)
  if (r?.syncId) { await enqueueSync('matchRecords', r.syncId); flushSync() }
}

export async function deleteMatch(matchId: number): Promise<void> {
  const r = await db.matchRecords.get(matchId)
  await db.matchRecords.delete(matchId)
  if (r?.syncId) { await enqueueSync('matchRecords', r.syncId, 'delete'); flushSync() }
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

  // Existing upcoming matches keyed by matchNumber — used for deduplication so
  // re-importing preserves battery assignments and avoids creating duplicate rows.
  const existingUpcoming = await db.matchRecords.where('status').equals('upcoming').toArray()
  const existingByMatchNum = new Map(existingUpcoming.map((r) => [r.matchNumber, r]))
  const tbaMatchNumbers = new Set(ourMatches.map((m) => m.match_number))

  // Upcoming records no longer present in TBA data should be removed.
  const toDelete = existingUpcoming.filter((r) => !tbaMatchNumbers.has(r.matchNumber))

  await db.transaction('rw', db.matchRecords, async () => {
    // Remove stale upcoming records
    for (const r of toDelete) {
      if (r.id !== undefined) await db.matchRecords.delete(r.id)
    }
    for (const m of ourMatches) {
      const allianceColor: 'red' | 'blue' = m.alliances.red.team_keys.includes(team) ? 'red' : 'blue'
      const scheduledTime = m.predicted_time ? m.predicted_time * 1000 : m.time * 1000
      const existing = existingByMatchNum.get(m.match_number)
      if (existing) {
        // Update timing + alliance color; preserve batteryId and other user data
        await db.matchRecords.update(existing.id!, { scheduledTime, allianceColor })
      } else {
        await db.matchRecords.add({
          syncId: generateId(),
          matchNumber: m.match_number,
          scheduledTime,
          batteryId: null, completedAt: null, status: 'upcoming',
          allianceColor,
        })
      }
    }
  })

  // Enqueue sync for deleted and upserted records
  for (const r of toDelete) if (r.syncId) await enqueueSync('matchRecords', r.syncId, 'delete')
  const allUpcoming = await db.matchRecords.where('status').equals('upcoming').toArray()
  for (const r of allUpcoming) if (r.syncId) await enqueueSync('matchRecords', r.syncId)
  flushSync()

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
