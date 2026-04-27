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
  batteryId: string;
  slotNumber: 1 | 2;              // two heater slots
  placedAt: number;
  removedAt: number | null;       // null = currently on heater
  forMatchNumber: number | null;
}

export interface MatchRecord {
  id?: number;
  matchNumber: number;
  scheduledTime: number;          // Unix ms
  batteryId: string | null;
  completedAt: number | null;
  status: 'upcoming' | 'active' | 'complete';
}

export interface AppSettings {
  key: string;                        // always "settings"
  eventName: string;
  teamNumber: number;
  seasonYear: number;
  heaterWarmMinutes: number;          // default 18
  walkAndQueueMinutes: number;        // lead time, default 20
  resistanceWarningThreshold: number; // milliohms, default 150
  overchargeWarningHours: number;     // default 4
  tbaApiKey: string;
  tbaEventKey: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  key: 'settings',
  eventName: '',
  teamNumber: 401,
  seasonYear: new Date().getFullYear(),
  heaterWarmMinutes: 18,
  walkAndQueueMinutes: 20,
  resistanceWarningThreshold: 150,
  overchargeWarningHours: 4,
  tbaApiKey: '',
  tbaEventKey: '',
}

// Derived types used only by the suggestion engine (never stored)

export type BatteryLocation = 'charger' | 'heater' | 'pit' | 'match'

export interface BatteryStatus {
  battery: Battery
  location: BatteryLocation
  chargerSlot?: number
  heaterSlot?: 1 | 2
  heaterPlacedAt?: number
}

export interface HeaterSlotSuggestion {
  slotNumber: 1 | 2
  batteryId: string | null           // null = no action needed
  action: 'place_now' | 'place_in' | 'ready' | 'occupied_not_ready' | 'idle'
  minutesUntilPlace: number | null
  minutesWarm: number | null         // how long it has been on heater
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
