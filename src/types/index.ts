export interface Battery {
  id: string;           // "2026A" — primary key
  year: number;
  label: string;        // "A"
  cycleCount: number;
  internalResistance: number | null; // milliohms
  notes: string;
  createdAt: number;    // Unix ms
}

export interface ChargerSession {
  id?: number;
  syncId?: string;     // UUID assigned at creation; used for cloud sync
  batteryId: string;
  slotNumber: number;              // 1–9
  placedAt: number;                // Unix ms
  removedAt: number | null;        // null = currently on charger
  voltageAtPlacement: number | null;
  voltageAtRemoval: number | null;
  resistanceAtPlacement: number | null;
  isFullCycle: boolean;
}

export interface HeaterSession {
  id?: number;
  syncId?: string;
  batteryId: string;
  slotNumber: number;
  placedAt: number;
  removedAt: number | null;       // null = currently on heater
  forMatchNumber: number | null;
  movedBy?: string;               // person who placed battery on heater
  removedBy?: string;             // person who removed battery (non-match removal)
  voltageAtRemoval?: number | null;
}

// Tracks every time a battery leaves the pit (match or practice field).
export interface BatteryUsageEvent {
  id?: number;
  syncId?: string;
  batteryId: string;
  eventType: 'match' | 'practice';
  matchNumber: number | null;     // null for practice
  takenAt: number;                // Unix ms
  returnedAt: number | null;      // null = still in use
  takenBy: string;
  voltageAtTake: number | null;   // V0 reading when taken
  resistanceAtTake: number | null;
  fromLocation: 'charger' | 'heater' | 'pit';
  fromSlot: number | null;
  notes: string;
}

export interface MatchRecord {
  id?: number;
  syncId?: string;
  matchNumber: number;
  scheduledTime: number;          // Unix ms
  batteryId: string | null;
  completedAt: number | null;
  status: 'upcoming' | 'active' | 'complete';
  allianceColor: 'red' | 'blue' | null;
}

export interface AppSettings {
  key: string;                   // always "settings"
  eventName: string;
  teamNumber: number;
  seasonYear: number;
  heaterWarmMinutes: number;     // default 30
  walkAndQueueMinutes: number;   // lead time, default 20
  heaterSlotCount: number;       // default 2
  chargeReadyMinutes: number;    // default 90
  tbaApiKey: string;
  tbaEventKey: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  key: 'settings',
  eventName: '',
  teamNumber: 401,
  seasonYear: new Date().getFullYear(),
  heaterWarmMinutes: 30,
  walkAndQueueMinutes: 20,
  heaterSlotCount: 2,
  chargeReadyMinutes: 90,
  tbaApiKey: '',
  tbaEventKey: '',
}

// Offline sync queue — records waiting to be pushed to Supabase
export interface PendingSync {
  table: string
  syncId: string
  operation: 'upsert' | 'delete'
  queuedAt: number
}

// Derived types used only by the suggestion engine (never stored)

export type BatteryLocation = 'charger' | 'heater' | 'pit' | 'in-use'

export interface BatteryStatus {
  battery: Battery
  location: BatteryLocation
  chargerSlot?: number
  chargerPlacedAt?: number   // Unix ms when placed on current charger session
  heaterSlot?: number
  heaterPlacedAt?: number
}

export interface HeaterSlotSuggestion {
  slotNumber: number
  batteryId: string | null
  action: 'place_now' | 'place_in' | 'ready' | 'occupied_not_ready' | 'idle'
  minutesUntilPlace: number | null
  minutesWarm: number | null         // how long it has been on heater
  placedAt: number | null            // absolute timestamp of heater placement
  targetPlacementMs: number | null   // absolute Unix ms when battery should be placed
  forMatchNumber: number | null
  minutesUntilDeadline: number | null
}

export interface MatchBatterySuggestion {
  batteryId: string
  reason: string
  score: number
  isWarm: boolean
  minutesOnHeater: number | null
}
