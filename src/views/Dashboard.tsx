import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSuggestions } from '../store/useSuggestions'
import { useActiveHeaterSessions, placeOnHeater, removeFromHeater } from '../store/useHeaterSlots'
import { useAllActiveChargerSessions, placeOnCharger, removeFromCharger, TOTAL_SLOTS } from '../store/useChargerSlots'
import { useSettings } from '../store/useSettings'
import { useUpcomingMatches, assignBatteryToMatch, startMatch } from '../store/useMatchSchedule'
import { recordUsageEvent, useUsageEvents } from '../store/useUsageEvents'
import { useBatteries } from '../store/useBatteries'
import { db } from '../db/schema'
import Modal from '../components/Modal'
import type { HeaterSlotSuggestion, HeaterSession, BatteryUsageEvent, ChargerSession } from '../types'

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function chargerLabel(slot: number): string {
  const charger = Math.ceil(slot / 3)
  const bay = ((slot - 1) % 3) + 1
  return `Charger ${charger} · Bay ${bay}`
}

function lastUsageLabel(event: BatteryUsageEvent | undefined): string | null {
  if (!event) return null
  if (event.eventType === 'match') return `Last: Match ${event.matchNumber}`
  return `Last: Practice ${formatTime(event.takenAt)}`
}

// ── Take for Match modal ──────────────────────────────────────────────────────

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
      await removeFromHeater(fromSession)
      await recordUsageEvent({
        batteryId, eventType: 'match', matchNumber: matchNumber ?? null,
        takenAt: Date.now(), returnedAt: null, takenBy: takenBy.trim(),
        voltageAtTake: voltage ? parseFloat(voltage) : null,
        resistanceAtTake: resistance ? parseFloat(resistance) : null,
        fromLocation: 'heater', fromSlot: fromSession.slotNumber, notes: '',
      })
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
          <label>Resistance (Ω)</label>
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

// ── Place on Heater modal ─────────────────────────────────────────────────────

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
    if (!result.ok) { setError(result.error ?? 'Could not place battery.'); setSubmitting(false); return }
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

  const progressPct = minutesWarm !== null ? Math.min(100, (minutesWarm / heaterWarmMinutes) * 100) : 0
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

      {!activeSession && batteryId && (
        <>
          <div className="heater-card__status">
            {action === 'place_now' ? '⚡ Place now!' : `⏱ Place in ${minutesUntilPlace}min`}
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

      {!activeSession && !batteryId && (
        <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
          No upcoming match
        </div>
      )}
    </div>
  )
}

// ── Charger slot modal ────────────────────────────────────────────────────────

interface ChargerSlotModalProps {
  slotNumber: number
  existingSession: ChargerSession | null
  lastUsageEvent: BatteryUsageEvent | undefined
  onClose: () => void
}

function ChargerSlotModal({ slotNumber, existingSession, lastUsageEvent, onClose }: ChargerSlotModalProps) {
  const batteries = useBatteries()
  const [batteryId, setBatteryId] = useState(existingSession?.batteryId ?? '')
  const [voltage, setVoltage] = useState('')
  const [resistance, setResistance] = useState('')
  const [voltageOut, setVoltageOut] = useState('')
  const [isFullCycle, setIsFullCycle] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [takenBy, setTakenBy] = useState('')
  const [practiceVoltage, setPracticeVoltage] = useState('')
  const [practiceResistance, setPracticeResistance] = useState('')
  const [showPractice, setShowPractice] = useState(false)

  const batteryUsageEvents = useLiveQuery(
    () => batteryId
      ? db.usageEvents.where('batteryId').equals(batteryId).toArray()
      : Promise.resolve([] as BatteryUsageEvent[]),
    [batteryId],
  ) ?? []
  const openUsageEvent = batteryUsageEvents.find((e) => e.returnedAt === null) ?? null

  async function handlePlace() {
    if (!batteryId) return
    setSubmitting(true); setError('')
    const result = await placeOnCharger(batteryId, slotNumber, voltage ? parseFloat(voltage) : null, resistance ? parseFloat(resistance) : null)
    setSubmitting(false)
    if (!result.ok) { setError(result.error ?? 'Could not place battery.'); return }
    onClose()
  }

  async function handleRemove() {
    if (!existingSession) return
    setSubmitting(true)
    await removeFromCharger(existingSession, voltageOut ? parseFloat(voltageOut) : null, isFullCycle)
    setSubmitting(false)
    onClose()
  }

  async function handleTakeForPractice() {
    if (!existingSession || !takenBy.trim()) { setError('Enter who is taking the battery.'); return }
    setSubmitting(true); setError('')
    try {
      await removeFromCharger(existingSession, practiceVoltage ? parseFloat(practiceVoltage) : null, false)
      await recordUsageEvent({
        batteryId: existingSession.batteryId, eventType: 'practice', matchNumber: null,
        takenAt: Date.now(), returnedAt: null, takenBy: takenBy.trim(),
        voltageAtTake: practiceVoltage ? parseFloat(practiceVoltage) : null,
        resistanceAtTake: practiceResistance ? parseFloat(practiceResistance) : null,
        fromLocation: 'charger', fromSlot: slotNumber, notes: '',
      })
      onClose()
    } catch {
      setError('Something went wrong.')
      setSubmitting(false)
    }
  }

  const elapsed = existingSession ? Date.now() - existingSession.placedAt : 0

  return (
    <Modal title={`Slot ${slotNumber} — ${chargerLabel(slotNumber)}`} onClose={onClose}>
      {existingSession ? (
        <>
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{existingSession.batteryId}</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
              On charger since {formatTime(existingSession.placedAt)} · {formatDuration(elapsed)}
            </div>
            {existingSession.voltageAtPlacement !== null && (
              <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                V0: {existingSession.voltageAtPlacement}V
                {existingSession.resistanceAtPlacement !== null && ` · ${existingSession.resistanceAtPlacement}Ω`}
              </div>
            )}
            {lastUsageEvent && (
              <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>
                {lastUsageLabel(lastUsageEvent)}
              </div>
            )}
          </div>
          {!showPractice ? (
            <>
              <div className="form-group">
                <label>Voltage at removal (V)</label>
                <input type="number" step="0.01" placeholder="e.g. 12.6" value={voltageOut}
                  onChange={(e) => setVoltageOut(e.target.value)} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <input type="checkbox" id="fullCycle" checked={isFullCycle}
                  onChange={(e) => setIsFullCycle(e.target.checked)} style={{ width: 'auto' }} />
                <label htmlFor="fullCycle" style={{ margin: 0, textTransform: 'none', fontSize: '0.9rem' }}>
                  Count as full charge cycle
                </label>
              </div>
              {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{error}</p>}
              <div className="row" style={{ marginBottom: '0.5rem' }}>
                <button className="btn-primary" style={{ flex: 1 }} onClick={handleRemove} disabled={submitting}>
                  Remove from charger
                </button>
                <button className="btn-ghost" onClick={onClose}>Cancel</button>
              </div>
              <button className="btn-ghost" style={{ width: '100%', fontSize: '0.85rem' }} onClick={() => setShowPractice(true)}>
                Take for practice field →
              </button>
            </>
          ) : (
            <>
              <h3 style={{ marginBottom: '0.75rem' }}>Take for Practice</h3>
              <div className="form-row">
                <div className="form-group">
                  <label>Voltage V0</label>
                  <input type="number" step="0.01" placeholder="e.g. 12.5" value={practiceVoltage}
                    onChange={(e) => setPracticeVoltage(e.target.value)} autoFocus />
                </div>
                <div className="form-group">
                  <label>Resistance (Ω)</label>
                  <input type="number" step="0.1" placeholder="e.g. 120" value={practiceResistance}
                    onChange={(e) => setPracticeResistance(e.target.value)} />
                </div>
              </div>
              <div className="form-group">
                <label>Taken by</label>
                <input type="text" placeholder="Name or initials" value={takenBy}
                  onChange={(e) => setTakenBy(e.target.value)} />
              </div>
              {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{error}</p>}
              <div className="row">
                <button className="btn-primary" style={{ flex: 1 }} onClick={handleTakeForPractice} disabled={submitting}>
                  {submitting ? 'Saving…' : 'Confirm — take for practice'}
                </button>
                <button className="btn-ghost" onClick={() => setShowPractice(false)}>Back</button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="form-group">
            <label>Battery</label>
            <select value={batteryId} onChange={(e) => setBatteryId(e.target.value)}>
              <option value="">Select battery…</option>
              {batteries.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
            </select>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Voltage V0</label>
              <input type="number" step="0.01" placeholder="e.g. 12.1" value={voltage}
                onChange={(e) => setVoltage(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Resistance (Ω)</label>
              <input type="number" step="0.1" placeholder="e.g. 120" value={resistance}
                onChange={(e) => setResistance(e.target.value)} />
            </div>
          </div>
          {openUsageEvent && (
            <div style={{ background: 'rgba(91,155,213,0.12)', border: '1px solid var(--color-info)', borderRadius: 'var(--radius-sm)', padding: '0.5rem 0.75rem', fontSize: '0.82rem', color: 'var(--color-info)', marginBottom: '0.75rem' }}>
              ℹ️ {batteryId} is currently {openUsageEvent.eventType === 'match' ? `in match ${openUsageEvent.matchNumber}` : 'at practice field'} — placing here will mark it as returned.
            </div>
          )}
          {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{error}</p>}
          <div className="row">
            <button className="btn-primary" style={{ flex: 1 }} onClick={handlePlace} disabled={!batteryId || submitting}>
              {openUsageEvent ? 'Return & place on charger' : 'Place on charger'}
            </button>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
    </Modal>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [now, setNow] = useState(() => Date.now())
  useState(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id) })

  const { heaterSuggestions, matchSuggestions } = useSuggestions()
  const activeHeaterSessions = useActiveHeaterSessions()
  const activeSessions = useAllActiveChargerSessions()
  const settings = useSettings()
  const upcomingMatches = useUpcomingMatches()
  const allUsageEvents = useUsageEvents()
  const allChargerSessions = useLiveQuery(() => db.chargerSessions.toArray(), []) ?? []

  const [takeForMatchTarget, setTakeForMatchTarget] = useState<{ suggestion: HeaterSlotSuggestion; session: HeaterSession } | null>(null)
  const [placeOnHeaterTarget, setPlaceOnHeaterTarget] = useState<HeaterSlotSuggestion | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)

  const nextMatch = upcomingMatches[0]
  const topSuggestion = matchSuggestions[0]
  const alternates = matchSuggestions.slice(1, 3)

  const sessionBySlot = Object.fromEntries(activeSessions.map((s) => [s.slotNumber, s]))

  const lastEventByBattery = new Map<string, BatteryUsageEvent>()
  for (const e of allUsageEvents) {
    const existing = lastEventByBattery.get(e.batteryId)
    if (!existing || e.takenAt > existing.takenAt) lastEventByBattery.set(e.batteryId, e)
  }

  // Suppress unused var — kept for future slot-history display
  void allChargerSessions

  return (
    <div className="stack">
      {/* Next match */}
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

      {/* Charger board */}
      <div>
        <div className="section-header">
          <h2>Chargers</h2>
          <span className="text-muted" style={{ fontSize: '0.8rem' }}>
            {activeSessions.length}/{TOTAL_SLOTS} slots
          </span>
        </div>
        {[1, 2, 3].map((charger) => (
          <div key={charger} style={{ marginBottom: '0.5rem' }}>
            <div className="section-header" style={{ marginBottom: '0.25rem' }}><h3>Charger {charger}</h3></div>
            <div className="grid-3">
              {[1, 2, 3].map((bay) => {
                const slot = (charger - 1) * 3 + bay
                const session = sessionBySlot[slot]
                const elapsed = session ? now - session.placedAt : 0
                const lastEvent = session ? lastEventByBattery.get(session.batteryId) : undefined

                if (session) {
                  return (
                    <div key={slot} className="bay-card bay-card--charging" onClick={() => setSelectedSlot(slot)}>
                      <div className="bay-card__header">
                        <span className="bay-card__slot">{slot}</span>
                        <span className="bay-card__battery-id">{session.batteryId}</span>
                      </div>
                      <div className="bay-card__header">
                        <span className="bay-card__detail">Since {formatTime(session.placedAt)}</span>
                        <span className="bay-card__detail">{formatDuration(elapsed)}</span>
                      </div>
                      {lastEvent && (
                        <div className="bay-card__time">{lastUsageLabel(lastEvent)}</div>
                      )}
                    </div>
                  )
                }

                return (
                  <div key={slot} className="bay-card bay-card--empty" onClick={() => setSelectedSlot(slot)}>
                    <div className="bay-card__header">
                      <span className="bay-card__slot">{slot}</span>
                      <span style={{ fontSize: '1.1rem', color: 'var(--color-text-muted)' }}>+</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
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
      {selectedSlot !== null && (
        <ChargerSlotModal
          slotNumber={selectedSlot}
          existingSession={sessionBySlot[selectedSlot] ?? null}
          lastUsageEvent={sessionBySlot[selectedSlot] ? lastEventByBattery.get(sessionBySlot[selectedSlot].batteryId) : undefined}
          onClose={() => setSelectedSlot(null)}
        />
      )}
    </div>
  )
}
