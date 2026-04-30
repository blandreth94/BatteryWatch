import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useBatteries, addBattery, updateBattery, deleteBattery } from '../store/useBatteries'
import { useAllActiveChargerSessions, placeOnCharger, removeFromCharger, TOTAL_SLOTS } from '../store/useChargerSlots'
import { useActiveHeaterSessions, placeOnHeater, removeFromHeater } from '../store/useHeaterSlots'
import { useSettings } from '../store/useSettings'
import { useActiveUsageEvents, recordUsageEvent, returnBattery } from '../store/useUsageEvents'
import { db } from '../db/schema'
import Modal from '../components/Modal'
import type { Battery, ChargerSession, HeaterSession, BatteryUsageEvent, AppSettings } from '../types'
import { formatTime, formatDate, formatRelative } from '../utils/time'
function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function locationLabel(
  battery: Battery,
  chargerSessions: ChargerSession[],
  heaterSessions: HeaterSession[],
  activeUsageEvents: BatteryUsageEvent[],
): string {
  const charger = chargerSessions.find((s) => s.batteryId === battery.id)
  if (charger) return `Charger slot ${charger.slotNumber}`
  const heater = heaterSessions.find((s) => s.batteryId === battery.id)
  if (heater) return `Heater ${heater.slotNumber}`
  const usage = activeUsageEvents.find((e) => e.batteryId === battery.id)
  if (usage) return usage.eventType === 'match' ? `Out · Match ${usage.matchNumber ?? '?'}` : 'Out · Practice'
  return 'Pit'
}

type HistoryEntry =
  | { type: 'charger'; session: ChargerSession; ts: number }
  | { type: 'heater'; session: HeaterSession; ts: number }
  | { type: 'usage'; event: BatteryUsageEvent; ts: number }

function buildHistory(
  chargerSessions: ChargerSession[],
  heaterSessions: HeaterSession[],
  usageEvents: BatteryUsageEvent[],
): HistoryEntry[] {
  const entries: HistoryEntry[] = [
    ...chargerSessions.map((s): HistoryEntry => ({ type: 'charger', session: s, ts: s.placedAt })),
    ...heaterSessions.map((s): HistoryEntry => ({ type: 'heater', session: s, ts: s.placedAt })),
    ...usageEvents.map((e): HistoryEntry => ({ type: 'usage', event: e, ts: e.takenAt })),
  ]
  return entries.sort((a, b) => b.ts - a.ts)
}

// ── Detail modal ──────────────────────────────────────────────────────────────

type OverrideScreen = 'main' | 'place-charger' | 'place-heater' | 'take-practice' | 'remove-charger' | 'remove-heater'

interface DetailModalProps {
  battery: Battery
  activeChargerSessions: ChargerSession[]
  activeHeaterSessions: HeaterSession[]
  activeUsageEvents: BatteryUsageEvent[]
  settings: AppSettings
  onClose: () => void
}

function DetailModal({ battery, activeChargerSessions, activeHeaterSessions, activeUsageEvents, settings, onClose }: DetailModalProps) {
  const [resistance, setResistance] = useState(battery.internalResistance?.toString() ?? '')
  const [notes, setNotes] = useState(battery.notes)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [screen, setScreen] = useState<OverrideScreen>('main')
  const [slot, setSlot] = useState('')
  const [voltage, setVoltage] = useState('')
  const [voltageOut, setVoltageOut] = useState('')
  const [res, setRes] = useState('')
  const [takenBy, setTakenBy] = useState('')
  const [movedBy, setMovedBy] = useState('')
  const [forMatch, setForMatch] = useState('')
  const [isFullCycle, setIsFullCycle] = useState(false)
  const [overrideError, setOverrideError] = useState('')
  const [overrideSubmitting, setOverrideSubmitting] = useState(false)

  const chargerSessions = useLiveQuery(
    () => db.chargerSessions.where('batteryId').equals(battery.id).reverse().sortBy('placedAt'),
    [battery.id],
  ) ?? []
  const heaterSessions = useLiveQuery(
    () => db.heaterSessions.where('batteryId').equals(battery.id).reverse().sortBy('placedAt'),
    [battery.id],
  ) ?? []
  const usageEvents = useLiveQuery(
    () => db.usageEvents.where('batteryId').equals(battery.id).reverse().sortBy('takenAt'),
    [battery.id],
  ) ?? []

  const history = buildHistory(chargerSessions, heaterSessions, usageEvents)

  const chargerSession = activeChargerSessions.find((s) => s.batteryId === battery.id) ?? null
  const heaterSession  = activeHeaterSessions.find((s) => s.batteryId === battery.id) ?? null
  const usageEvent     = activeUsageEvents.find((e) => e.batteryId === battery.id) ?? null

  const occupiedChargerSlots = new Set(activeChargerSessions.map((s) => s.slotNumber))
  const occupiedHeaterSlots  = new Set(activeHeaterSessions.map((s) => s.slotNumber))
  const heaterSlots = Array.from({ length: settings.heaterSlotCount }, (_, i) => i + 1)

  function resetOverride() {
    setSlot(''); setVoltage(''); setVoltageOut(''); setRes(''); setTakenBy('')
    setMovedBy(''); setForMatch(''); setIsFullCycle(false)
    setOverrideError(''); setOverrideSubmitting(false)
  }
  function goBack() { resetOverride(); setScreen('main') }

  async function handleSave() {
    setSaving(true)
    await updateBattery(battery.id, {
      internalResistance: resistance ? parseFloat(resistance) : null,
      notes,
    })
    setSaving(false)
    onClose()
  }

  async function handleDelete() {
    await deleteBattery(battery.id)
    onClose()
  }

  async function handleReturn() {
    if (!usageEvent?.id) return
    setOverrideSubmitting(true)
    await returnBattery(usageEvent.id)
    onClose()
  }

  async function handlePlaceCharger() {
    if (!slot) { setOverrideError('Select a slot.'); return }
    setOverrideSubmitting(true); setOverrideError('')
    const result = await placeOnCharger(
      battery.id, parseInt(slot),
      voltage ? parseFloat(voltage) : null,
      res ? parseFloat(res) : null,
    )
    setOverrideSubmitting(false)
    if (!result.ok) { setOverrideError(result.error ?? 'Could not place battery.'); return }
    onClose()
  }

  async function handlePlaceHeater() {
    if (!slot) { setOverrideError('Select a slot.'); return }
    setOverrideSubmitting(true); setOverrideError('')
    const result = await placeOnHeater(
      battery.id, parseInt(slot),
      forMatch ? parseInt(forMatch) : null,
      movedBy.trim() || undefined,
    )
    setOverrideSubmitting(false)
    if (!result.ok) { setOverrideError(result.error ?? 'Could not place battery.'); return }
    onClose()
  }

  async function handleTakePractice() {
    if (!takenBy.trim()) { setOverrideError('Enter who is taking the battery.'); return }
    setOverrideSubmitting(true); setOverrideError('')
    try {
      const fromLocation = chargerSession ? 'charger' : heaterSession ? 'heater' : 'pit'
      const fromSlot = chargerSession?.slotNumber ?? heaterSession?.slotNumber ?? null
      if (chargerSession) await removeFromCharger(chargerSession, voltage ? parseFloat(voltage) : null, false)
      else if (heaterSession) await removeFromHeater(heaterSession, undefined, voltage ? parseFloat(voltage) : null)
      await recordUsageEvent({
        batteryId: battery.id, eventType: 'practice', matchNumber: null,
        takenAt: Date.now(), returnedAt: null, takenBy: takenBy.trim(),
        voltageAtTake: voltage ? parseFloat(voltage) : null,
        resistanceAtTake: res ? parseFloat(res) : null,
        fromLocation, fromSlot, notes: '',
      })
      onClose()
    } catch {
      setOverrideError('Something went wrong.')
      setOverrideSubmitting(false)
    }
  }

  async function handleRemoveCharger() {
    if (!chargerSession) return
    setOverrideSubmitting(true)
    await removeFromCharger(chargerSession, voltageOut ? parseFloat(voltageOut) : null, isFullCycle)
    onClose()
  }

  async function handleRemoveHeater() {
    if (!heaterSession) return
    setOverrideSubmitting(true)
    await removeFromHeater(heaterSession, movedBy.trim() || undefined, voltageOut ? parseFloat(voltageOut) : null)
    onClose()
  }

  // ── Override sub-screens ────────────────────────────────────────────────────

  if (screen === 'place-charger') {
    return (
      <Modal title={`Place ${battery.id} on Charger`} onClose={onClose}>
        {usageEvent && (
          <div style={{ background: 'rgba(91,155,213,0.12)', border: '1px solid var(--color-info)', borderRadius: 'var(--radius-sm)', padding: '0.5rem 0.75rem', fontSize: '0.82rem', color: 'var(--color-info)', marginBottom: '0.75rem' }}>
            ℹ️ Currently {usageEvent.eventType === 'match' ? `in match ${usageEvent.matchNumber}` : 'at practice'} — placing here will mark it as returned.
          </div>
        )}
        <div className="form-group">
          <label>Slot</label>
          <select value={slot} onChange={(e) => setSlot(e.target.value)}>
            <option value="">Select slot…</option>
            {Array.from({ length: TOTAL_SLOTS }, (_, i) => i + 1).map((s) => (
              <option key={s} value={s}>{s}{occupiedChargerSlots.has(s) ? ' (occupied)' : ''}</option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Voltage V0</label>
            <input type="number" step="0.01" placeholder="e.g. 12.1" value={voltage} onChange={(e) => setVoltage(e.target.value)} autoFocus />
          </div>
          <div className="form-group">
            <label>Resistance (Ω)</label>
            <input type="number" step="0.1" placeholder="e.g. 120" value={res} onChange={(e) => setRes(e.target.value)} />
          </div>
        </div>
        {overrideError && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{overrideError}</p>}
        <div className="row">
          <button className="btn-primary" style={{ flex: 1 }} onClick={handlePlaceCharger} disabled={!slot || overrideSubmitting}>
            {overrideSubmitting ? 'Saving…' : 'Place on charger'}
          </button>
          <button className="btn-ghost" onClick={goBack}>Back</button>
        </div>
      </Modal>
    )
  }

  if (screen === 'place-heater') {
    return (
      <Modal title={`Place ${battery.id} on Heater`} onClose={onClose}>
        <div className="form-group">
          <label>Slot</label>
          <select value={slot} onChange={(e) => setSlot(e.target.value)}>
            <option value="">Select slot…</option>
            {heaterSlots.map((s) => (
              <option key={s} value={s}>{s}{occupiedHeaterSlots.has(s) ? ' (occupied)' : ''}</option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>For match # (optional)</label>
            <input type="number" placeholder="e.g. 12" value={forMatch} onChange={(e) => setForMatch(e.target.value)} autoFocus />
          </div>
          <div className="form-group">
            <label>Moved by (optional)</label>
            <input type="text" placeholder="Name or initials" value={movedBy} onChange={(e) => setMovedBy(e.target.value)} />
          </div>
        </div>
        {chargerSession && (
          <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
            Currently on charger slot {chargerSession.slotNumber} — that session will be closed.
          </p>
        )}
        {overrideError && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{overrideError}</p>}
        <div className="row">
          <button className="btn-primary" style={{ flex: 1 }} onClick={handlePlaceHeater} disabled={!slot || overrideSubmitting}>
            {overrideSubmitting ? 'Saving…' : 'Place on heater'}
          </button>
          <button className="btn-ghost" onClick={goBack}>Back</button>
        </div>
      </Modal>
    )
  }

  if (screen === 'take-practice') {
    const sourceLabel = chargerSession
      ? `Charger slot ${chargerSession.slotNumber}`
      : heaterSession
        ? `Heater ${heaterSession.slotNumber}`
        : 'Pit'
    return (
      <Modal title={`Take ${battery.id} for Practice`} onClose={onClose}>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
          Taking from {sourceLabel}.
        </p>
        <div className="form-row">
          <div className="form-group">
            <label>Voltage V0</label>
            <input type="number" step="0.01" placeholder="e.g. 12.5" value={voltage} onChange={(e) => setVoltage(e.target.value)} autoFocus />
          </div>
          <div className="form-group">
            <label>Resistance (Ω)</label>
            <input type="number" step="0.1" placeholder="e.g. 120" value={res} onChange={(e) => setRes(e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label>Taken by</label>
          <input type="text" placeholder="Name or initials" value={takenBy} onChange={(e) => setTakenBy(e.target.value)} />
        </div>
        {overrideError && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{overrideError}</p>}
        <div className="row">
          <button className="btn-primary" style={{ flex: 1 }} onClick={handleTakePractice} disabled={overrideSubmitting}>
            {overrideSubmitting ? 'Saving…' : 'Confirm — take for practice'}
          </button>
          <button className="btn-ghost" onClick={goBack}>Back</button>
        </div>
      </Modal>
    )
  }

  if (screen === 'remove-charger') {
    return (
      <Modal title={`Remove ${battery.id} from Charger`} onClose={onClose}>
        <div className="form-group">
          <label>Voltage at removal (V)</label>
          <input type="number" step="0.01" placeholder="e.g. 12.6" value={voltageOut} onChange={(e) => setVoltageOut(e.target.value)} autoFocus />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <input type="checkbox" id="fullCycle" checked={isFullCycle} onChange={(e) => setIsFullCycle(e.target.checked)} style={{ width: 'auto' }} />
          <label htmlFor="fullCycle" style={{ margin: 0, textTransform: 'none', fontSize: '0.9rem' }}>Count as full charge cycle</label>
        </div>
        {overrideError && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{overrideError}</p>}
        <div className="row">
          <button className="btn-primary" style={{ flex: 1 }} onClick={handleRemoveCharger} disabled={overrideSubmitting}>
            {overrideSubmitting ? 'Saving…' : 'Remove from charger'}
          </button>
          <button className="btn-ghost" onClick={goBack}>Back</button>
        </div>
      </Modal>
    )
  }

  if (screen === 'remove-heater') {
    return (
      <Modal title={`Remove ${battery.id} from Heater`} onClose={onClose}>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-warning)', marginBottom: '0.75rem' }}>
          Allow 30 minutes for the battery to cool before charging.
        </p>
        <div className="form-row">
          <div className="form-group">
            <label>Voltage at removal (V)</label>
            <input type="number" step="0.01" placeholder="e.g. 12.5" value={voltageOut} onChange={(e) => setVoltageOut(e.target.value)} autoFocus />
          </div>
          <div className="form-group">
            <label>Removed by (optional)</label>
            <input type="text" placeholder="Name or initials" value={movedBy} onChange={(e) => setMovedBy(e.target.value)} />
          </div>
        </div>
        {overrideError && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{overrideError}</p>}
        <div className="row">
          <button className="btn-primary" style={{ flex: 1 }} onClick={handleRemoveHeater} disabled={overrideSubmitting}>
            {overrideSubmitting ? 'Saving…' : 'Remove from heater'}
          </button>
          <button className="btn-ghost" onClick={goBack}>Back</button>
        </div>
      </Modal>
    )
  }

  // ── Main screen ──────────────────────────────────────────────────────────────

  const loc = locationLabel(battery, activeChargerSessions, activeHeaterSessions, activeUsageEvents)

  return (
    <Modal title={battery.id} onClose={onClose}>
      {/* Stats row */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <span className="badge badge-muted">{battery.cycleCount} cycles</span>
        {battery.internalResistance !== null && (
          <span className="badge badge-muted">{battery.internalResistance}Ω</span>
        )}
        <span className="badge badge-muted">{loc}</span>
      </div>

      {/* Edit fields */}
      <div className="form-group">
        <label>Internal resistance (Ω)</label>
        <input type="number" step="0.1" placeholder="e.g. 120" value={resistance}
          onChange={(e) => setResistance(e.target.value)} />
      </div>
      <div className="form-group">
        <label>Notes</label>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="row" style={{ marginBottom: '1rem' }}>
        <button className="btn-primary" style={{ flex: 1 }} onClick={handleSave} disabled={saving}>Save</button>
        {confirmDelete ? (
          <>
            <button className="btn-danger" onClick={handleDelete}>Yes, delete</button>
            <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>No</button>
          </>
        ) : (
          <button className="btn-ghost" style={{ color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
            onClick={() => setConfirmDelete(true)}>Delete</button>
        )}
      </div>

      {/* Status override actions */}
      <div style={{ marginBottom: '1rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}>
        <div className="stack" style={{ gap: '0.4rem' }}>
          {!chargerSession && !heaterSession && !usageEvent && (
            <>
              <button className="btn-ghost" style={{ width: '100%', fontSize: '0.85rem' }} onClick={() => setScreen('place-charger')}>Place on Charger →</button>
              <button className="btn-ghost" style={{ width: '100%', fontSize: '0.85rem' }} onClick={() => setScreen('place-heater')}>Place on Heater →</button>
              <button className="btn-ghost" style={{ width: '100%', fontSize: '0.85rem' }} onClick={() => setScreen('take-practice')}>Take for Practice →</button>
            </>
          )}
          {chargerSession && (
            <>
              <button className="btn-ghost" style={{ width: '100%', fontSize: '0.85rem' }} onClick={() => setScreen('place-heater')}>Move to Heater →</button>
              <button className="btn-ghost" style={{ width: '100%', fontSize: '0.85rem' }} onClick={() => setScreen('take-practice')}>Take for Practice →</button>
              <button className="btn-ghost" style={{ width: '100%', fontSize: '0.85rem' }} onClick={() => setScreen('remove-charger')}>Remove from Charger →</button>
            </>
          )}
          {heaterSession && (
            <>
              <button className="btn-ghost" style={{ width: '100%', fontSize: '0.85rem' }} onClick={() => setScreen('take-practice')}>Take for Practice →</button>
              <button className="btn-ghost" style={{ width: '100%', fontSize: '0.85rem' }} onClick={() => setScreen('remove-heater')}>Remove from Heater →</button>
            </>
          )}
          {usageEvent && (
            <button
              className="btn-ghost"
              style={{ width: '100%', fontSize: '0.85rem', color: 'var(--color-warning)', borderColor: 'var(--color-warning)' }}
              onClick={handleReturn}
              disabled={overrideSubmitting}
            >
              Return to Pit
            </button>
          )}
        </div>
      </div>

      {/* Full history */}
      <h3 style={{ marginBottom: '0.5rem' }}>History</h3>
      {history.length === 0 && (
        <p className="text-muted" style={{ fontSize: '0.85rem' }}>No history yet.</p>
      )}
      <div className="stack" style={{ gap: '0.5rem', maxHeight: '50vh', overflowY: 'auto' }}>
        {history.map((entry, i) => {
          if (entry.type === 'charger') {
            const s = entry.session
            const duration = s.removedAt ? s.removedAt - s.placedAt : null
            return (
              <div key={`c-${s.id ?? i}`} style={{ fontSize: '0.82rem', padding: '0.5rem 0.75rem', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span>🔌 Charger slot {s.slotNumber}
                    <span className="text-muted" style={{ fontWeight: 400 }}> · {formatDate(s.placedAt)}</span>
                  </span>
                  <span className="text-muted" style={{ fontWeight: 400, fontSize: '0.75rem' }}>{formatRelative(s.placedAt)}</span>
                </div>
                <div className="text-muted">
                  {formatTime(s.placedAt)} → {s.removedAt ? formatTime(s.removedAt) : 'ongoing'}
                  {duration ? ` (${formatDuration(duration)})` : ''}
                </div>
                {(s.voltageAtPlacement !== null || s.voltageAtRemoval !== null) && (
                  <div className="text-muted">
                    V: {s.voltageAtPlacement ?? '–'} → {s.voltageAtRemoval ?? '–'}
                    {s.resistanceAtPlacement !== null && ` · ${s.resistanceAtPlacement}Ω`}
                  </div>
                )}
                {s.isFullCycle && <div style={{ color: 'var(--color-success)' }}>Full cycle counted</div>}
              </div>
            )
          }

          if (entry.type === 'heater') {
            const s = entry.session
            const duration = s.removedAt ? s.removedAt - s.placedAt : null
            return (
              <div key={`h-${s.id ?? i}`} style={{ fontSize: '0.82rem', padding: '0.5rem 0.75rem', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span>🔥 Heater {s.slotNumber}
                    {s.forMatchNumber && ` · Match ${s.forMatchNumber}`}
                    <span className="text-muted" style={{ fontWeight: 400 }}> · {formatDate(s.placedAt)}</span>
                  </span>
                  <span className="text-muted" style={{ fontWeight: 400, fontSize: '0.75rem' }}>{formatRelative(s.placedAt)}</span>
                </div>
                <div className="text-muted">
                  {formatTime(s.placedAt)} → {s.removedAt ? formatTime(s.removedAt) : 'ongoing'}
                  {duration ? ` (${formatDuration(duration)})` : ''}
                </div>
              </div>
            )
          }

          const e = entry.event
          const duration = e.returnedAt ? e.returnedAt - e.takenAt : null
          const icon = e.eventType === 'match' ? '🤖' : '🏟️'
          const label = e.eventType === 'match' ? `Match ${e.matchNumber}` : 'Practice'
          return (
            <div key={`u-${e.id ?? i}`} style={{ fontSize: '0.82rem', padding: '0.5rem 0.75rem', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--color-primary)' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span>{icon} {label}
                  <span className="text-muted" style={{ fontWeight: 400 }}> · {formatDate(e.takenAt)}</span>
                </span>
                <span className="text-muted" style={{ fontWeight: 400, fontSize: '0.75rem' }}>{formatRelative(e.takenAt)}</span>
              </div>
              <div className="text-muted">
                Taken by {e.takenBy} at {formatTime(e.takenAt)}
                {e.returnedAt && ` · returned ${formatTime(e.returnedAt)}`}
                {duration && ` (${formatDuration(duration)})`}
              </div>
              {(e.voltageAtTake !== null || e.resistanceAtTake !== null) && (
                <div className="text-muted">
                  {e.voltageAtTake !== null && `V0: ${e.voltageAtTake}V`}
                  {e.resistanceAtTake !== null && ` · ${e.resistanceAtTake}Ω`}
                </div>
              )}
              {!e.returnedAt && <div style={{ color: 'var(--color-warning)', marginTop: '0.2rem' }}>Not yet returned</div>}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

// ── Add Battery modal ─────────────────────────────────────────────────────────

interface AddModalProps { onClose: () => void; defaultYear: number }

function AddModal({ onClose, defaultYear }: AddModalProps) {
  const [label, setLabel] = useState('')
  const [year, setYear] = useState(defaultYear.toString())
  const [submitting, setSubmitting] = useState(false)

  async function handleAdd() {
    if (!label.trim()) return
    setSubmitting(true)
    await addBattery(parseInt(year), label.trim().toUpperCase())
    setSubmitting(false)
    onClose()
  }

  return (
    <Modal title="Add Battery" onClose={onClose}>
      <div className="form-row">
        <div className="form-group">
          <label>Year</label>
          <input type="number" value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Label (A, B, C…)</label>
          <input type="text" maxLength={3} placeholder="A" value={label}
            onChange={(e) => setLabel(e.target.value.toUpperCase())} autoFocus />
        </div>
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
        Battery ID will be: <strong>{year}{label || '?'}</strong>
      </p>
      <div className="row">
        <button className="btn-primary" style={{ flex: 1 }} onClick={handleAdd} disabled={!label.trim() || submitting}>Add</button>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}

// ── Batteries list ────────────────────────────────────────────────────────────

export default function Batteries() {
  const batteries = useBatteries()
  const activeChargerSessions = useAllActiveChargerSessions()
  const activeHeaterSessions = useActiveHeaterSessions()
  const activeUsageEvents = useActiveUsageEvents()
  const settings = useSettings()
  const [selected, setSelected] = useState<Battery | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  return (
    <div className="stack">
      <div className="section-header">
        <h1>Batteries</h1>
        <button className="btn-primary" style={{ fontSize: '0.85rem' }} onClick={() => setShowAdd(true)}>+ Add</button>
      </div>

      {batteries.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <p className="text-muted">No batteries yet. Add your first battery above.</p>
        </div>
      )}

      {batteries.map((battery) => {
        const loc = locationLabel(battery, activeChargerSessions, activeHeaterSessions, activeUsageEvents)
        return (
          <div key={battery.id} className="battery-row" onClick={() => setSelected(battery)}>
            <div className="battery-row__id">{battery.id}</div>
            <div className="battery-row__meta">
              <div>{battery.cycleCount} cycles · {loc}</div>
              {battery.internalResistance !== null && (
                <div>{battery.internalResistance}Ω</div>
              )}
              {battery.notes && <div style={{ fontStyle: 'italic' }}>{battery.notes}</div>}
            </div>
            <span>›</span>
          </div>
        )
      })}

      {selected && (
        <DetailModal
          battery={selected}
          activeChargerSessions={activeChargerSessions}
          activeHeaterSessions={activeHeaterSessions}
          activeUsageEvents={activeUsageEvents}
          settings={settings}
          onClose={() => setSelected(null)}
        />
      )}
      {showAdd && (
        <AddModal onClose={() => setShowAdd(false)} defaultYear={settings.seasonYear} />
      )}
    </div>
  )
}
