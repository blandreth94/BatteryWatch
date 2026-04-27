import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useBatteries, addBattery, updateBattery, deleteBattery } from '../store/useBatteries'
import { useAllActiveChargerSessions } from '../store/useChargerSlots'
import { useActiveHeaterSessions } from '../store/useHeaterSlots'
import { useSettings } from '../store/useSettings'
import { useActiveUsageEvents } from '../store/useUsageEvents'
import { db } from '../db/schema'
import Modal from '../components/Modal'
import type { Battery, ChargerSession, HeaterSession, BatteryUsageEvent } from '../types'

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })
}
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

// ── History entry types ───────────────────────────────────────────────────────

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
  return entries.sort((a, b) => b.ts - a.ts) // newest first
}

// ── Detail modal ──────────────────────────────────────────────────────────────

interface DetailModalProps {
  battery: Battery
  onClose: () => void
}

function DetailModal({ battery, onClose }: DetailModalProps) {
  const [resistance, setResistance] = useState(battery.internalResistance?.toString() ?? '')
  const [notes, setNotes] = useState(battery.notes)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

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

  return (
    <Modal title={battery.id} onClose={onClose}>
      {/* Stats row */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <span className="badge badge-muted">{battery.cycleCount} cycles</span>
        {battery.internalResistance !== null && (
          <span className="badge badge-muted">{battery.internalResistance}mΩ</span>
        )}
      </div>

      {/* Edit fields */}
      <div className="form-group">
        <label>Internal resistance (mΩ)</label>
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
                <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>
                  🔌 Charger slot {s.slotNumber}
                  <span className="text-muted" style={{ fontWeight: 400 }}> · {formatDate(s.placedAt)}</span>
                </div>
                <div className="text-muted">
                  {formatTime(s.placedAt)} → {s.removedAt ? formatTime(s.removedAt) : 'ongoing'}
                  {duration ? ` (${formatDuration(duration)})` : ''}
                </div>
                {(s.voltageAtPlacement !== null || s.voltageAtRemoval !== null) && (
                  <div className="text-muted">
                    V: {s.voltageAtPlacement ?? '–'} → {s.voltageAtRemoval ?? '–'}
                    {s.resistanceAtPlacement !== null && ` · ${s.resistanceAtPlacement}mΩ`}
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
                <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>
                  🔥 Heater {s.slotNumber}
                  {s.forMatchNumber && ` · Match ${s.forMatchNumber}`}
                  <span className="text-muted" style={{ fontWeight: 400 }}> · {formatDate(s.placedAt)}</span>
                </div>
                <div className="text-muted">
                  {formatTime(s.placedAt)} → {s.removedAt ? formatTime(s.removedAt) : 'ongoing'}
                  {duration ? ` (${formatDuration(duration)})` : ''}
                </div>
              </div>
            )
          }

          // usage event
          const e = entry.event
          const duration = e.returnedAt ? e.returnedAt - e.takenAt : null
          const icon = e.eventType === 'match' ? '🤖' : '🏟️'
          const label = e.eventType === 'match' ? `Match ${e.matchNumber}` : 'Practice'
          return (
            <div key={`u-${e.id ?? i}`} style={{ fontSize: '0.82rem', padding: '0.5rem 0.75rem', background: 'var(--color-surface-2)', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--color-primary)' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>
                {icon} {label}
                <span className="text-muted" style={{ fontWeight: 400 }}> · {formatDate(e.takenAt)}</span>
              </div>
              <div className="text-muted">
                Taken by {e.takenBy} at {formatTime(e.takenAt)}
                {e.returnedAt && ` · returned ${formatTime(e.returnedAt)}`}
                {duration && ` (${formatDuration(duration)})`}
              </div>
              {(e.voltageAtTake !== null || e.resistanceAtTake !== null) && (
                <div className="text-muted">
                  {e.voltageAtTake !== null && `V0: ${e.voltageAtTake}V`}
                  {e.resistanceAtTake !== null && ` · ${e.resistanceAtTake}mΩ`}
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
                <div>{battery.internalResistance}mΩ</div>
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
          onClose={() => setSelected(null)}
        />
      )}
      {showAdd && (
        <AddModal onClose={() => setShowAdd(false)} defaultYear={settings.seasonYear} />
      )}
    </div>
  )
}
