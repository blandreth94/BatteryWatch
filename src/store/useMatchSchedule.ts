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

  // Gather syncIds of records about to be deleted so we can push deletes
  const toDelete = await db.matchRecords.where('status').equals('upcoming').toArray()
  const deletedSyncIds = toDelete.map((r) => r.syncId).filter(Boolean) as string[]

  await db.transaction('rw', db.matchRecords, async () => {
    await db.matchRecords.where('status').equals('upcoming').delete()
    for (const m of ourMatches) {
      await db.matchRecords.add({
        syncId: generateId(),
        matchNumber: m.match_number,
        scheduledTime: m.predicted_time ? m.predicted_time * 1000 : m.time * 1000,
        batteryId: null, completedAt: null, status: 'upcoming',
        allianceColor: m.alliances.red.team_keys.includes(team) ? 'red' : 'blue',
      })
    }
  })

  // Enqueue all changes
  for (const syncId of deletedSyncIds) await enqueueSync('matchRecords', syncId, 'delete')
  const newRecords = await db.matchRecords.where('status').equals('upcoming').toArray()
  for (const r of newRecords) if (r.syncId) await enqueueSync('matchRecords', r.syncId)
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
