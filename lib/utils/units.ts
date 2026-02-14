/**
 * Unit conversion utilities for imperial/metric display
 *
 * All data is stored internally in metric (meters, seconds-per-km).
 * These functions convert at the display boundary only.
 */

export type UnitSystem = 'metric' | 'imperial'

const KM_TO_MILES = 0.621371
const METERS_TO_FEET = 3.28084

// --- Raw conversion (numbers only) ---

export function toDisplayDistance(meters: number, units: UnitSystem): number {
  const km = meters / 1000
  return units === 'imperial' ? km * KM_TO_MILES : km
}

export function toDisplayElevation(meters: number, units: UnitSystem): number {
  return units === 'imperial' ? meters * METERS_TO_FEET : meters
}

// --- Formatted strings ---

export function formatDistance(meters: number, units: UnitSystem, decimals: number = 2): string {
  const value = toDisplayDistance(meters, units)
  const label = units === 'imperial' ? 'mi' : 'km'
  return `${value.toFixed(decimals)} ${label}`
}

export function formatPace(secsPerKm: number, units: UnitSystem): string {
  let displaySecs = secsPerKm
  if (units === 'imperial') {
    // seconds-per-km -> seconds-per-mile
    displaySecs = secsPerKm / KM_TO_MILES
  }
  const minutes = Math.floor(displaySecs / 60)
  const seconds = Math.round(displaySecs % 60)
  const label = units === 'imperial' ? '/mi' : '/km'
  return `${minutes}:${seconds.toString().padStart(2, '0')}${label}`
}

export function formatElevation(meters: number, units: UnitSystem): string {
  const value = toDisplayElevation(meters, units)
  const label = units === 'imperial' ? 'ft' : 'm'
  return `${Math.round(value)} ${label}`
}

// --- Labels ---

export function distanceLabel(units: UnitSystem): string {
  return units === 'imperial' ? 'mi' : 'km'
}

export function paceLabel(units: UnitSystem): string {
  return units === 'imperial' ? '/mi' : '/km'
}

export function elevationLabel(units: UnitSystem): string {
  return units === 'imperial' ? 'ft' : 'm'
}
