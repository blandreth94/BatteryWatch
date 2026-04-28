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
  onRemove: () => void
}

function HeaterSlotCard({ suggestion, activeSession, heaterWarmMinutes, nextMatchId: _nextMatchId, now: _now, onTakeForMatch, onPlaceConfirm, onRemove }: HeaterSlotCardProps) {
  let cardClass = 'heater-card'
  const { action, batteryId, minutesWarm, placedAt, minutesUntilPlace, forMatchNumber } = suggestion

  if (action === 'ready') cardClass += ' heater-card--warm'
  else if (action === 'occupied_not_ready') cardClass += ' heater-card--active'
  else if (action === 'place_now') cardClass += ' heater-card--action'

  const progressPct = minutesWarm !== null ? Math.min(100, (minutesWarm / heaterWarmMinutes) * 100) : 0

  return (
    <div className={cardClass}>
      {/* Header row: label left, battery ID right */}
      <div className="heater-card__header">
        <div className="heater-card__label">
          Heater {suggestion.slotNumber}
          {forMatchNumber ? ` · Match ${forMatchNumber}` : ''}
        </div>
        <div className="heater-card__battery">
          {batteryId ?? <span className="text-muted" style={{ fontWeight: 400, fontSize: '0.9rem' }}>Empty</span>}
        </div>
      </div>

      {activeSession && minutesWarm !== null && (
        <>
          {/* Status + placed-at on one line */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '0.82rem' }}>
            <span className="heater-card__status" style={{ fontSize: '0.82rem' }}>
              {action === 'ready' ? '✅ Ready' : '🔥 Warming'}
              {' — '}{minutesWarm}min / {heaterWarmMinutes}min
            </span>
            {placedAt && (
              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                since {formatTime(placedAt)}
              </span>
            )}
          </div>
          <div className="heater-card__progress">
            <div
              className={`heater-card__progress-fill${action === 'ready' ? ' heater-card__progress-fill--done' : ''}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {/* Action buttons side by side */}
          <div className="row" style={{ marginTop: '0.4rem', gap: '0.4rem' }}>
            {action === 'ready' ? (
              <button className="btn-primary" style={{ flex: 1 }} onClick={onTakeForMatch}>
                Take for M{forMatchNumber}
              </button>
            ) : (
              <button className="btn-ghost" style={{ flex: 1 }} onClick={onTakeForMatch}>
                Take anyway
              </button>
            )}
            <button
              className="btn-ghost"
              style={{ flex: 1, fontSize: '0.78rem', color: 'var(--color-text-muted)' }}
              onClick={onRemove}
            >
              Remove
            </button>
          </div>
        </>
      )}

      {!activeSession && batteryId && (
        <>
          <div className="heater-card__status" style={{ fontSize: '0.82rem' }}>
            {action === 'place_now' ? '⚡ Place now!' : `⏱ Place in ${minutesUntilPlace}min`}
          </div>
          <button
            className={action === 'place_now' ? 'btn-primary' : 'btn-ghost'}
            style={{ marginTop: '0.4rem', width: '100%' }}
            onClick={onPlaceConfirm}
          >
            {action === 'place_now' ? 'Place on heater' : 'Place now'}
          </button>
        </>
      )}

      {!activeSession && !batteryId && (
        <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
          {forMatchNumber ? 'No eligible batteries available' : 'No upcoming match'}
        </div>
      )}
    </div>
  )
}

// ── Move to Heater modal ──────────────────────────────────────────────────────

interface MoveToHeaterModalProps {
  session: ChargerSession
  targetSlot: number
  nextMatchNumber: number | null
  onClose: () => void
}

function MoveToHeaterModal({ session, targetSlot, nextMatchNumber, onClose }: MoveToHeaterModalProps) {
  const [voltage, setVoltage] = useState('')
  const [resistance, setResistance] = useState('')
  const [movedBy, setMovedBy] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const chargeMinutes = Math.floor((Date.now() - session.placedAt) / 60_000)
  const underCharged = chargeMinutes < 60

  async function handleConfirm() {
    if (!movedBy.trim()) { setError('Please enter who is moving the battery.'); return }
    setSubmitting(true)
    try {
      await removeFromCharger(session, voltage ? parseFloat(voltage) : null, false)
      const result = await placeOnHeater(
        session.batteryId, targetSlot, nextMatchNumber, movedBy.trim(),
      )
      if (!result.ok) { setError(result.error ?? 'Could not place on heater.'); setSubmitting(false); return }
      onClose()
    } catch {
      setError('Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Modal title={`Move ${session.batteryId} → Heater ${targetSlot}`} onClose={onClose}>
      <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
        Remove from charger and place on heater {targetSlot}
        {nextMatchNumber ? ` for Match ${nextMatchNumber}` : ''}.
      </p>

      {underCharged && (
        <div style={{ background: 'rgba(224,82,82,0.12)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-sm)', padding: '0.6rem 0.75rem', marginBottom: '0.9rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--color-danger)', fontWeight: 600, marginBottom: '0.35rem' }}>
            ⚠️ Only charged for {chargeMinutes} min — may not be fully charged
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox" id="ack" checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)} style={{ width: 'auto' }} />
            <label htmlFor="ack" style={{ margin: 0, textTransform: 'none', fontSize: '0.85rem', color: 'var(--color-danger)' }}>
              I understand, move it anyway
            </label>
          </div>
        </div>
      )}

      <div className="form-row">
        <div className="form-group">
          <label>Voltage V0</label>
          <input type="number" step="0.01" placeholder="e.g. 12.6" value={voltage}
            onChange={(e) => setVoltage(e.target.value)} autoFocus={!underCharged} />
        </div>
        <div className="form-group">
          <label>Resistance (Ω)</label>
          <input type="number" step="0.1" placeholder="e.g. 120" value={resistance}
            onChange={(e) => setResistance(e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label>Moved by</label>
        <input type="text" placeholder="Name or initials" value={movedBy}
          onChange={(e) => setMovedBy(e.target.value)} />
      </div>
      {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{error}</p>}
      <div className="row">
        <button className="btn-primary" style={{ flex: 1 }} onClick={handleConfirm}
          disabled={submitting || (underCharged && !acknowledged)}>
          {submitting ? 'Moving…' : 'Confirm — move to heater'}
        </button>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}

// ── Remove from Heater modal (non-match) ──────────────────────────────────────

interface RemoveFromHeaterModalProps {
  session: HeaterSession
  onClose: () => void
}

function RemoveFromHeaterModal({ session, onClose }: RemoveFromHeaterModalProps) {
  const [voltage, setVoltage] = useState('')
  const [removedBy, setRemovedBy] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleConfirm() {
    if (!removedBy.trim()) { setError('Please enter who is removing the battery.'); return }
    setSubmitting(true)
    await removeFromHeater(session, removedBy.trim(), voltage ? parseFloat(voltage) : null)
    setDone(true)
    setSubmitting(false)
  }

  if (done) {
    return (
      <Modal title="Battery Removed" onClose={onClose}>
        <div style={{ textAlign: 'center', padding: '0.5rem 0 1rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🌡️</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.4rem' }}>
            {session.batteryId} removed from heater
          </div>
          <div style={{ background: 'rgba(224,82,82,0.12)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-sm)', padding: '0.75rem', fontSize: '0.9rem', color: 'var(--color-danger)', marginBottom: '1.25rem' }}>
            Allow <strong>30 minutes to cool</strong> before placing on charger
          </div>
          <button className="btn-primary" style={{ width: '100%' }} onClick={onClose}>Got it</button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={`Remove ${session.batteryId} from Heater ${session.slotNumber}`} onClose={onClose}>
      <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
        End-of-day removal or early pull. Battery will need 30 min to cool before charging.
      </p>
      <div className="form-group">
        <label>Voltage (optional)</label>
        <input type="number" step="0.01" placeholder="e.g. 12.6" value={voltage}
          onChange={(e) => setVoltage(e.target.value)} autoFocus />
      </div>
      <div className="form-group">
        <label>Removed by</label>
        <input type="text" placeholder="Name or initials" value={removedBy}
          onChange={(e) => setRemovedBy(e.target.value)} />
      </div>
      {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{error}</p>}
      <div className="row">
        <button className="btn-primary" style={{ flex: 1 }} onClick={handleConfirm}
          disabled={!removedBy.trim() || submitting}>
          {submitting ? 'Saving…' : 'Remove from heater'}
        </button>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}

// ── Charger slot modal ────────────────────────────────────────────────────────

interface ChargerSlotModalProps {
  slotNumber: number
  existingSession: ChargerSession | null
  lastUsageEvent: BatteryUsageEvent | undefined
  availableHeaterSlot: number | null
  nextMatchNumber: number | null
  defaultBatteryId?: string
  onMoveToHeater: () => void
  onClose: () => void
}

function ChargerSlotModal({ slotNumber, existingSession, lastUsageEvent, availableHeaterSlot, nextMatchNumber, defaultBatteryId, onMoveToHeater, onClose }: ChargerSlotModalProps) {
  const batteries = useBatteries()
  const [batteryId, setBatteryId] = useState(existingSession?.batteryId ?? defaultBatteryId ?? '')
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
              <button
                className="btn-ghost"
                style={{
                  width: '100%', fontSize: '0.85rem', marginTop: '0.35rem',
                  color: availableHeaterSlot !== null ? 'var(--color-primary)' : undefined,
                  borderColor: availableHeaterSlot !== null ? 'var(--color-primary)' : undefined,
                  opacity: availableHeaterSlot !== null ? 1 : 0.45,
                }}
                disabled={availableHeaterSlot === null}
                onClick={availableHeaterSlot !== null ? onMoveToHeater : undefined}
              >
                {availableHeaterSlot !== null
                  ? `Move to Heater ${availableHeaterSlot}${nextMatchNumber ? ` (Match ${nextMatchNumber})` : ''} →`
                  : 'Move to Heater (both slots full)'}
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
  const allBatteries = useBatteries()
  const settings = useSettings()
  const upcomingMatches = useUpcomingMatches()
  const allUsageEvents = useUsageEvents()

  const [takeForMatchTarget, setTakeForMatchTarget] = useState<{ suggestion: HeaterSlotSuggestion; session: HeaterSession } | null>(null)
  const [placeOnHeaterTarget, setPlaceOnHeaterTarget] = useState<HeaterSlotSuggestion | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)
  const [moveToHeaterSession, setMoveToHeaterSession] = useState<ChargerSession | null>(null)
  const [removeFromHeaterTarget, setRemoveFromHeaterTarget] = useState<HeaterSession | null>(null)

  const occupiedHeaterSlots = new Set(activeHeaterSessions.map((s) => s.slotNumber))
  const heaterSlotNums = Array.from({ length: settings.heaterSlotCount }, (_, i) => i + 1)
  const availableHeaterSlot = heaterSlotNums.find((s) => !occupiedHeaterSlots.has(s)) ?? null

  const nextMatch = upcomingMatches[0]
  const topSuggestion = matchSuggestions[0]
  const alternates = matchSuggestions.slice(1, 3)

  const sessionBySlot = Object.fromEntries(activeSessions.map((s) => [s.slotNumber, s]))

  const lastEventByBattery = new Map<string, BatteryUsageEvent>()
  for (const e of allUsageEvents) {
    const existing = lastEventByBattery.get(e.batteryId)
    if (!existing || e.takenAt > existing.takenAt) lastEventByBattery.set(e.batteryId, e)
  }

  // Batteries that need charging: not currently on a charger or heater.
  // Includes in-use batteries so they can be quickly returned to a charger slot.
  // Sorted by most recently taken out first (just returned from match → place first).
  const activeUsageByBattery = new Map<string, BatteryUsageEvent>()
  for (const e of allUsageEvents) {
    if (e.returnedAt === null) activeUsageByBattery.set(e.batteryId, e)
  }
  const chargerSet = new Set(activeSessions.map((s) => s.batteryId))
  const heaterSet = new Set(activeHeaterSessions.map((s) => s.batteryId))
  const batteriesNeedingCharge = allBatteries
    .filter((b) => !chargerSet.has(b.id) && !heaterSet.has(b.id))
    .sort((a, b) => {
      const aLast = lastEventByBattery.get(a.id)
      const bLast = lastEventByBattery.get(b.id)
      if (!aLast && !bLast) return 0
      if (!aLast) return 1
      if (!bLast) return -1
      return bLast.takenAt - aLast.takenAt  // most recently used first
    })

  // Assign suggestions to empty slots in order
  const emptySlots = Array.from({ length: TOTAL_SLOTS }, (_, i) => i + 1).filter((s) => !sessionBySlot[s])
  const suggestedBatteryBySlot = new Map<number, string>()
  batteriesNeedingCharge.forEach((b, idx) => {
    if (idx < emptySlots.length) suggestedBatteryBySlot.set(emptySlots[idx], b.id)
  })

  return (
    <div className="stack">
      {/* Next match */}
      {nextMatch ? (
        <div className="card">
          <div className="section-header">
            <h2>Next Up: Match {nextMatch.matchNumber}</h2>
          </div>
          {topSuggestion ? (
            <div className="suggestion-card" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div className="suggestion-card__battery" style={{ flexShrink: 0 }}>{topSuggestion.batteryId}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="suggestion-card__label" style={{ marginBottom: '0.15rem' }}>Recommended</div>
                <div className="suggestion-card__reason">{topSuggestion.reason}</div>
                {alternates.length > 0 && (
                  <div className="suggestion-card__alts" style={{ marginTop: '0.2rem' }}>
                    Alt: {alternates.map((a) => a.batteryId).join(', ')}
                  </div>
                )}
              </div>
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
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${settings.heaterSlotCount}, 1fr)`, gap: '0.75rem' }}>
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
                onRemove={() => activeSession && setRemoveFromHeaterTarget(activeSession)}
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
                      <div className="bay-card__header" style={{ marginTop: 'auto' }}>
                        {lastEvent
                          ? <span className="bay-card__time" style={{ marginTop: 0 }}>{lastUsageLabel(lastEvent)}</span>
                          : <span />}
                        <button
                          className="btn-ghost"
                          style={{
                            fontSize: '0.7rem', padding: '0.15rem 0.4rem', lineHeight: 1.2,
                            color: availableHeaterSlot !== null ? 'var(--color-primary)' : undefined,
                            borderColor: availableHeaterSlot !== null ? 'var(--color-primary)' : undefined,
                            opacity: availableHeaterSlot !== null ? 1 : 0.4,
                          }}
                          disabled={availableHeaterSlot === null}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (availableHeaterSlot !== null) setMoveToHeaterSession(session)
                          }}
                        >
                          → Heater
                        </button>
                      </div>
                    </div>
                  )
                }

                const suggestedId = suggestedBatteryBySlot.get(slot)
                const suggestedInUse = suggestedId ? activeUsageByBattery.get(suggestedId) : undefined
                return (
                  <div key={slot} className="bay-card bay-card--empty" onClick={() => setSelectedSlot(slot)}>
                    <div className="bay-card__header">
                      <span className="bay-card__slot">{slot}</span>
                      {suggestedId
                        ? <span className="bay-card__battery-id" style={{ opacity: 0.5 }}>{suggestedId}</span>
                        : <span style={{ fontSize: '1.1rem', color: 'var(--color-text-muted)' }}>+</span>}
                    </div>
                    {suggestedId && (
                      <div className="bay-card__detail" style={{ marginTop: '0.2rem' }}>
                        {suggestedInUse
                          ? `← ${suggestedInUse.eventType === 'match' ? `Match ${suggestedInUse.matchNumber}` : 'Practice'}`
                          : 'Tap to place'}
                      </div>
                    )}
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
          availableHeaterSlot={availableHeaterSlot}
          nextMatchNumber={nextMatch?.matchNumber ?? null}
          defaultBatteryId={sessionBySlot[selectedSlot] ? undefined : suggestedBatteryBySlot.get(selectedSlot)}
          onMoveToHeater={() => {
            const session = sessionBySlot[selectedSlot]
            if (session) { setMoveToHeaterSession(session); setSelectedSlot(null) }
          }}
          onClose={() => setSelectedSlot(null)}
        />
      )}
      {moveToHeaterSession !== null && availableHeaterSlot !== null && (
        <MoveToHeaterModal
          session={moveToHeaterSession}
          targetSlot={availableHeaterSlot}
          nextMatchNumber={nextMatch?.matchNumber ?? null}
          onClose={() => setMoveToHeaterSession(null)}
        />
      )}
      {removeFromHeaterTarget !== null && (
        <RemoveFromHeaterModal
          session={removeFromHeaterTarget}
          onClose={() => setRemoveFromHeaterTarget(null)}
        />
      )}
    </div>
  )
}
