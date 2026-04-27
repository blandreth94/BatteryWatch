import { useState } from 'react'
import { useSuggestions } from '../store/useSuggestions'
import { useActiveHeaterSessions, placeOnHeater, removeFromHeater } from '../store/useHeaterSlots'
import { useSettings } from '../store/useSettings'
import { useUpcomingMatches, assignBatteryToMatch, startMatch } from '../store/useMatchSchedule'
import { recordUsageEvent } from '../store/useUsageEvents'
import Modal from '../components/Modal'
import type { HeaterSlotSuggestion, HeaterSession } from '../types'

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ── Take for Match modal ─────────────────────────────────────────────────────

interface TakeForMatchModalProps {
  batteryId: string
  fromSession: HeaterSession
  matchNumber: number | null
  matchId: number | undefined
  onClose: () => void
}

function TakeForMatchModal({ batteryId, fromSession, matchNumber, matchId, onClose }: TakeForMatchModalProps) {
  const [voltage, setVoltage] = useState('')
  const [resistance, setResistance] = useState('')
  const [takenBy, setTakenBy] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleConfirm() {
    if (!takenBy.trim()) { setError('Please enter who is taking the battery.'); return }
    setSubmitting(true)
    try {
      // Close the heater session
      await removeFromHeater(fromSession)

      // Record the usage event
      await recordUsageEvent({
        batteryId,
        eventType: 'match',
        matchNumber: matchNumber ?? null,
        takenAt: Date.now(),
        returnedAt: null,
        takenBy: takenBy.trim(),
        voltageAtTake: voltage ? parseFloat(voltage) : null,
        resistanceAtTake: resistance ? parseFloat(resistance) : null,
        fromLocation: 'heater',
        fromSlot: fromSession.slotNumber,
        notes: '',
      })

      // Assign + activate the match
      if (matchId !== undefined) {
        await assignBatteryToMatch(matchId, batteryId)
        await startMatch(matchId)
      }

      onClose()
    } catch {
      setError('Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Modal title={`Take ${batteryId} for Match ${matchNumber ?? '?'}`} onClose={onClose}>
      <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
        Record battery stats before taking it to the robot.
      </p>
      <div className="form-row">
        <div className="form-group">
          <label>Voltage V0</label>
          <input type="number" step="0.01" placeholder="e.g. 12.5" value={voltage}
            onChange={(e) => setVoltage(e.target.value)} autoFocus />
        </div>
        <div className="form-group">
          <label>Resistance (mΩ)</label>
          <input type="number" step="0.1" placeholder="e.g. 120" value={resistance}
            onChange={(e) => setResistance(e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label>Taken by</label>
        <input type="text" placeholder="Name or initials" value={takenBy}
          onChange={(e) => setTakenBy(e.target.value)} />
      </div>
      {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{error}</p>}
      <div className="row">
        <button className="btn-primary" style={{ flex: 1 }} onClick={handleConfirm} disabled={submitting}>
          {submitting ? 'Saving…' : 'Confirm — take battery'}
        </button>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}

// ── Place on Heater modal (from suggestion) ───────────────────────────────────

interface PlaceOnHeaterModalProps {
  suggestion: HeaterSlotSuggestion
  matchNumber: number | null
  onClose: () => void
}

function PlaceOnHeaterModal({ suggestion, matchNumber, onClose }: PlaceOnHeaterModalProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handlePlace() {
    if (!suggestion.batteryId) return
    setSubmitting(true)
    const result = await placeOnHeater(suggestion.batteryId, suggestion.slotNumber, matchNumber)
    if (!result.ok) {
      setError(result.error ?? 'Could not place battery.')
      setSubmitting(false)
      return
    }
    onClose()
  }

  return (
    <Modal title={`Place ${suggestion.batteryId} on Heater ${suggestion.slotNumber}`} onClose={onClose}>
      <p style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
        For <strong>Match {matchNumber}</strong>. Confirm placement?
      </p>
      {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{error}</p>}
      <div className="row">
        <button className="btn-primary" style={{ flex: 1 }} onClick={handlePlace} disabled={submitting}>
          {submitting ? 'Saving…' : 'Confirm'}
        </button>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}

// ── Heater slot card ──────────────────────────────────────────────────────────

interface HeaterSlotCardProps {
  suggestion: HeaterSlotSuggestion
  activeSession: HeaterSession | null
  heaterWarmMinutes: number
  nextMatchId: number | undefined
  now: number
  onTakeForMatch: () => void
  onPlaceConfirm: () => void
}

function HeaterSlotCard({ suggestion, activeSession, heaterWarmMinutes, nextMatchId: _nextMatchId, now, onTakeForMatch, onPlaceConfirm }: HeaterSlotCardProps) {
  let cardClass = 'heater-card'
  const { action, batteryId, minutesWarm, placedAt, minutesUntilPlace, forMatchNumber } = suggestion

  if (action === 'ready') cardClass += ' heater-card--warm'
  else if (action === 'occupied_not_ready') cardClass += ' heater-card--active'
  else if (action === 'place_now') cardClass += ' heater-card--action'

  const progressPct = minutesWarm !== null
    ? Math.min(100, (minutesWarm / heaterWarmMinutes) * 100)
    : 0

  const totalOnHeaterMs = activeSession ? now - activeSession.placedAt : null

  return (
    <div className={cardClass}>
      <div className="heater-card__label">
        Heater {suggestion.slotNumber}
        {forMatchNumber ? ` · Match ${forMatchNumber}` : ''}
      </div>

      <div className="heater-card__battery">
        {batteryId ?? <span className="text-muted" style={{ fontWeight: 400, fontSize: '1rem' }}>Empty</span>}
      </div>

      {/* Active on heater */}
      {activeSession && minutesWarm !== null && (
        <>
          <div className="heater-card__status">
            {action === 'ready' ? '✅ Ready' : '🔥 Warming'}
            {' — '}{minutesWarm}min / {heaterWarmMinutes}min
          </div>
          {placedAt && (
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              Placed at {formatTime(placedAt)}
              {totalOnHeaterMs !== null && ` · ${formatDuration(totalOnHeaterMs)} total`}
            </div>
          )}
          <div className="heater-card__progress">
            <div
              className={`heater-card__progress-fill${action === 'ready' ? ' heater-card__progress-fill--done' : ''}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {action === 'ready' && (
            <button className="btn-primary" style={{ marginTop: '0.5rem', width: '100%' }} onClick={onTakeForMatch}>
              Take for Match {forMatchNumber}
            </button>
          )}
          {action === 'occupied_not_ready' && (
            <button className="btn-ghost" style={{ marginTop: '0.5rem', width: '100%' }} onClick={onTakeForMatch}>
              Take anyway
            </button>
          )}
        </>
      )}

      {/* Suggestion — not yet placed */}
      {!activeSession && batteryId && (
        <>
          <div className="heater-card__status">
            {action === 'place_now'
              ? '⚡ Place now!'
              : `⏱ Place in ${minutesUntilPlace}min`}
          </div>
          <button
            className={action === 'place_now' ? 'btn-primary' : 'btn-ghost'}
            style={{ marginTop: '0.5rem', width: '100%' }}
            onClick={onPlaceConfirm}
          >
            {action === 'place_now' ? 'Place on heater' : 'Place now'}
          </button>
        </>
      )}

      {/* Idle — no upcoming match */}
      {!activeSession && !batteryId && (
        <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
          No upcoming match
        </div>
      )}
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [now, setNow] = useState(() => Date.now())
  useState(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id) })

  const { heaterSuggestions, matchSuggestions } = useSuggestions()
  const activeHeaterSessions = useActiveHeaterSessions()
  const settings = useSettings()
  const upcomingMatches = useUpcomingMatches()

  const [takeForMatchTarget, setTakeForMatchTarget] = useState<{ suggestion: HeaterSlotSuggestion; session: HeaterSession } | null>(null)
  const [placeOnHeaterTarget, setPlaceOnHeaterTarget] = useState<HeaterSlotSuggestion | null>(null)

  const nextMatch = upcomingMatches[0]
  const topSuggestion = matchSuggestions[0]
  const alternates = matchSuggestions.slice(1, 3)

  return (
    <div className="stack">
      {/* Next match card */}
      {nextMatch ? (
        <div className="card">
          <div className="section-header">
            <h2>Next Up: Match {nextMatch.matchNumber}</h2>
          </div>
          {topSuggestion ? (
            <div className="suggestion-card">
              <div className="suggestion-card__label">Recommended battery</div>
              <div className="suggestion-card__battery">{topSuggestion.batteryId}</div>
              <div className="suggestion-card__reason">{topSuggestion.reason}</div>
              {alternates.length > 0 && (
                <div className="suggestion-card__alts">
                  Alt: {alternates.map((a) => a.batteryId).join(', ')}
                </div>
              )}
            </div>
          ) : (
            <p className="text-muted" style={{ fontSize: '0.9rem' }}>
              No batteries available — check charger board.
            </p>
          )}
        </div>
      ) : (
        <div className="card">
          <p className="text-muted" style={{ textAlign: 'center', padding: '1rem 0' }}>
            No upcoming matches. Add matches in the Schedule tab.
          </p>
        </div>
      )}

      {/* Heater slots */}
      <div>
        <div className="section-header"><h2>Heater Slots</h2></div>
        <div className="grid-2">
          {heaterSuggestions.map((s) => {
            const activeSession = activeHeaterSessions.find((h) => h.slotNumber === s.slotNumber) ?? null
            return (
              <HeaterSlotCard
                key={s.slotNumber}
                suggestion={s}
                activeSession={activeSession}
                heaterWarmMinutes={settings.heaterWarmMinutes}
                nextMatchId={nextMatch?.id}
                now={now}
                onTakeForMatch={() => activeSession && setTakeForMatchTarget({ suggestion: s, session: activeSession })}
                onPlaceConfirm={() => setPlaceOnHeaterTarget(s)}
              />
            )
          })}
        </div>
      </div>

      {/* Modals */}
      {takeForMatchTarget && (
        <TakeForMatchModal
          batteryId={takeForMatchTarget.suggestion.batteryId!}
          fromSession={takeForMatchTarget.session}
          matchNumber={takeForMatchTarget.suggestion.forMatchNumber}
          matchId={nextMatch?.id}
          onClose={() => setTakeForMatchTarget(null)}
        />
      )}
      {placeOnHeaterTarget && (
        <PlaceOnHeaterModal
          suggestion={placeOnHeaterTarget}
          matchNumber={placeOnHeaterTarget.forMatchNumber}
          onClose={() => setPlaceOnHeaterTarget(null)}
        />
      )}
    </div>
  )
}
