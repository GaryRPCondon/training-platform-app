/**
 * ICS (iCalendar) export for training plans.
 *
 * Generates a .ics file string containing all scheduled workouts as all-day
 * events. The file can be imported into Google Calendar, Apple Calendar, etc.
 */

import { getWorkoutPaceType, formatPace } from '@/lib/training/vdot'
import { toDisplayDistance, distanceLabel, type UnitSystem } from '@/lib/utils/units'
import type { TrainingPaces } from '@/types/database'

export interface ICSWorkout {
  id: number
  scheduled_date: string               // YYYY-MM-DD
  workout_type: string
  description: string | null
  distance_target_meters: number | null
  duration_target_seconds: number | null
  intensity_target: string | null
  structured_workout: any | null
  status: string
  version: number
}

export interface ICSExportInput {
  planName: string
  workouts: ICSWorkout[]
  trainingPaces?: TrainingPaces | null
  units?: UnitSystem
}

/**
 * Escape text for ICS format.
 * Backslash-escapes commas, semicolons, and backslashes, and converts
 * newlines to literal \n sequences.
 */
function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * Return the day after `dateStr` in YYYYMMDD format.
 * ICS all-day events use DTEND = day after the event.
 */
function nextDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/**
 * Format YYYY-MM-DD to YYYYMMDD (ICS DATE value).
 */
function toICSDate(dateStr: string): string {
  return dateStr.replace(/-/g, '')
}

/**
 * Build the SUMMARY line for a workout event.
 * Mirrors formatWorkoutTitle logic from training-calendar.tsx.
 */
function formatICSTitle(workout: ICSWorkout, units: UnitSystem): string {
  const description = workout.description || 'Workout'

  const hasDistanceInDescription = /\d+\.?\d*\s?(km|k|miles?|mi)\b/i.test(description)

  if (workout.distance_target_meters && !hasDistanceInDescription) {
    const dist = toDisplayDistance(workout.distance_target_meters, units).toFixed(1)
    const label = distanceLabel(units)
    return `${description} ${dist}${label}`
  }

  if (workout.duration_target_seconds) {
    const mins = Math.round(workout.duration_target_seconds / 60)
    return `${description} ${mins}min`
  }

  return description
}

/**
 * Build the DESCRIPTION body for a workout event.
 * Includes workout type, intensity, pace targets, and structured workout info.
 */
function formatICSDescription(
  workout: ICSWorkout,
  trainingPaces: TrainingPaces | null | undefined,
  units: UnitSystem
): string {
  const lines: string[] = []

  // Workout type
  const typeLabel = workout.workout_type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
  lines.push(`Type: ${typeLabel}`)

  // Distance
  if (workout.distance_target_meters) {
    const dist = toDisplayDistance(workout.distance_target_meters, units).toFixed(1)
    const label = distanceLabel(units)
    lines.push(`Distance: ${dist} ${label}`)
  }

  // Duration
  if (workout.duration_target_seconds) {
    const mins = Math.round(workout.duration_target_seconds / 60)
    lines.push(`Duration: ${mins} min`)
  }

  // Intensity
  if (workout.intensity_target) {
    lines.push(`Intensity: ${workout.intensity_target}`)
  }

  // Pace target from training paces
  if (trainingPaces) {
    const paceType = getWorkoutPaceType(workout.workout_type)
    const paceSeconds = trainingPaces[paceType]
    if (paceSeconds) {
      lines.push(`Target Pace: ${formatPace(paceSeconds, units)} (${paceType})`)
    }
  }

  // Structured workout summary
  if (workout.structured_workout) {
    const sw = workout.structured_workout
    if (typeof sw === 'string') {
      lines.push(`\nWorkout: ${sw}`)
    } else if (sw.summary) {
      lines.push(`\nWorkout: ${sw.summary}`)
    } else if (sw.steps && Array.isArray(sw.steps)) {
      lines.push(`\nSteps: ${sw.steps.length} segments`)
    }
  }

  return lines.join('\n')
}

/**
 * Generate a UTC timestamp for DTSTAMP in ICS format.
 */
function nowUTC(): string {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const h = String(d.getUTCHours()).padStart(2, '0')
  const min = String(d.getUTCMinutes()).padStart(2, '0')
  const s = String(d.getUTCSeconds()).padStart(2, '0')
  return `${y}${m}${day}T${h}${min}${s}Z`
}

/**
 * Fold long ICS lines at 75 octets per RFC 5545 §3.1.
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line
  const parts: string[] = []
  parts.push(line.slice(0, 75))
  let i = 75
  while (i < line.length) {
    parts.push(' ' + line.slice(i, i + 74))
    i += 74
  }
  return parts.join('\r\n')
}

/**
 * Generate an ICS calendar string from a training plan's workouts.
 */
export function generateICS({ planName, workouts, trainingPaces, units = 'metric' }: ICSExportInput): string {
  const stamp = nowUTC()

  const scheduledWorkouts = workouts.filter(w => w.status === 'scheduled')

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TrainerApp//Training Plan//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICSText(planName)}`,
  ]

  for (const workout of scheduledWorkouts) {
    const title = formatICSTitle(workout, units)
    const desc = formatICSDescription(workout, trainingPaces, units)
    const category = workout.workout_type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:workout-${workout.id}@trainer-app`)
    lines.push(`DTSTAMP:${stamp}`)
    lines.push(`DTSTART;VALUE=DATE:${toICSDate(workout.scheduled_date)}`)
    lines.push(`DTEND;VALUE=DATE:${nextDay(workout.scheduled_date)}`)
    lines.push(`SUMMARY:${escapeICSText(title)}`)
    lines.push(`DESCRIPTION:${escapeICSText(desc)}`)
    lines.push(`CATEGORIES:${escapeICSText(category)}`)
    lines.push(`SEQUENCE:${workout.version || 0}`)
    lines.push('TRANSP:TRANSPARENT')
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')

  // Fold long lines and use CRLF line endings per RFC 5545
  return lines.map(foldLine).join('\r\n') + '\r\n'
}
