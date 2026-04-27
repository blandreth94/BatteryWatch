import { useState } from 'react'
import { useBatteries, addBattery, updateBattery, deleteBattery } from '../store/useBatteries'
import { useAllActiveChargerSessions } from '../store/useChargerSlots'
import { useActiveHeaterSessions } from '../store/useHeaterSlots'
import { useSettings } from '../store/useSettings'
import Modal from '../components/Modal'
import type { Battery } from '../types'

function locationLabel(
  battery: Battery,
  chargerSessions: ReturnType<typeof useAllActiveChargerSessions>,
  heaterSessions: ReturnType<typeof useActiveHeaterSessions>,
): string {
  const charger = chargerSessions.find((s) => s.batteryId === battery.id)
  if (charger) return `Charger slot ${charger.slotNumber}`
  const heater = heaterSessions.find((s) => s.batteryId === battery.id)
  if (heater) return `Heater ${heater.slotNumber}`
  return 'Pit'
}

interface DetailModalProps {
  battery: Battery
  onClose: () => void
  resistanceThreshold: number
}

function DetailModal({ battery, onClose, resistanceThreshold }: DetailModalProps) {
  const [resistance, setResistance] = useState(battery.internalResistance?.toString() ?? '')
  const [notes, setNotes] = useState(battery.notes)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

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
      <div style={{ marginBottom: '0.75rem' }}>
        <span className="badge badge-muted">{battery.cycleCount} cycles</span>
        {battery.internalResistance !== null && battery.internalResistance > resistanceThreshold && (
          <span className="badge badge-danger" style={{ marginLeft: '0.4rem' }}>High resistance</span>
        )}
      </div>
      <div className="form-group">
        <label>Internal resistance (mΩ)</label>
        <input
          type="number"
          step="0.1"
          placeholder="e.g. 120"
          value={resistance}
          onChange={(e) => setResistance(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label>Notes</label>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="row" style={{ marginTop: '0.5rem' }}>
        <button className="btn-primary" style={{ flex: 1 }} onClick={handleSave} disabled={saving}>Save</button>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
      </div>
      {confirmDelete ? (
        <div className="row" style={{ marginTop: '0.75rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--color-danger)' }}>Delete permanently?</span>
          <button className="btn-danger" onClick={handleDelete}>Yes, delete</button>
          <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>No</button>
        </div>
      ) : (
        <button className="btn-ghost" style={{ marginTop: '0.75rem', color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }} onClick={() => setConfirmDelete(true)}>
          Delete battery
        </button>
      )}
    </Modal>
  )
}

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
          <input
            type="text"
            maxLength={3}
            placeholder="A"
            value={label}
            onChange={(e) => setLabel(e.target.value.toUpperCase())}
            autoFocus
          />
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

export default function Batteries() {
  const batteries = useBatteries()
  const activeChargerSessions = useAllActiveChargerSessions()
  const activeHeaterSessions = useActiveHeaterSessions()
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
        const isDegraded = battery.internalResistance !== null && battery.internalResistance > settings.resistanceWarningThreshold
        const loc = locationLabel(battery, activeChargerSessions, activeHeaterSessions)
        return (
          <div key={battery.id} className="battery-row" onClick={() => setSelected(battery)}>
            <div className="battery-row__id">{battery.id}</div>
            <div className="battery-row__meta">
              <div>{battery.cycleCount} cycles · {loc}</div>
              {battery.internalResistance !== null && (
                <div>{battery.internalResistance}mΩ{isDegraded ? ' ⚠️' : ''}</div>
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
          resistanceThreshold={settings.resistanceWarningThreshold}
        />
      )}
      {showAdd && (
        <AddModal onClose={() => setShowAdd(false)} defaultYear={settings.seasonYear} />
      )}
    </div>
  )
}
