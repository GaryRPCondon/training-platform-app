import type { ParsedPlan } from './response-parser'
import { calculateTotalWorkoutDistance } from '@/lib/training/vdot'
import type { TrainingPaces } from '@/types/database'
import type { FullTemplate, PaceTarget, WeekSchedule } from '@/lib/templates/types'

export interface WorkoutValidationWarning {
  workoutIndex: string
  weekNumber: number
  dayNumber: number
  description: string
  workoutType: string
  actualDistance: number
  expectedRange: { min: number; max: number }
  message: string
  severity?: 'warning' | 'error'
  kind?: 'distance' | 'weekly_total' | 'long_run_cap' | 'rest_day_overshoot'
}

const TOLERANCE = 0.10 // ±10%

/**
 * Validate workout distances for potential LLM hallucinations.
 * Uses template-specific validation ranges with ±10% tolerance.
 *
 * Distance compared against the range is the *total session distance*
 * (warmup + main set + recovery + cooldown), matching what the workout
 * card displays. The validation_ranges in templates likewise represent
 * total session distances.
 */
export function validateWorkoutDistances(
  parsedPlan: ParsedPlan,
  validationRanges: Record<string, { min: number; max: number }>,
  trainingPaces?: TrainingPaces | null,
  paceTargets?: Record<string, PaceTarget>
): WorkoutValidationWarning[] {
  const warnings: WorkoutValidationWarning[] = []

  for (const week of parsedPlan.weeks) {
    for (const workout of week.workouts) {
      const workoutType = workout.type.toLowerCase()
      const range = validationRanges[workoutType]

      if (!range) {
        continue
      }

      // Skip rest and cross-training (no distance validation needed)
      if (range.min === 0 && range.max === 0) {
        continue
      }

      // Skip time-prescribed intensities — their distance is inferred from pace
      // and would falsely trip the range check (e.g. walks at slow pace × long duration).
      if (workout.intensity && paceTargets?.[workout.intensity]?.prescription === 'time') {
        continue
      }

      const actualDistance = calculateTotalWorkoutDistance(
        workout.distance_meters,
        workout.type,
        workout.structured_workout,
        trainingPaces
      )

      if (!actualDistance || actualDistance === 0) {
        continue
      }

      const effectiveMin = range.min * (1 - TOLERANCE)
      const effectiveMax = range.max * (1 + TOLERANCE)

      if (actualDistance < effectiveMin || actualDistance > effectiveMax) {
        warnings.push({
          workoutIndex: workout.workout_index,
          weekNumber: week.week_number,
          dayNumber: workout.day,
          description: workout.description || 'Untitled workout',
          workoutType: workout.type,
          actualDistance,
          expectedRange: range,
          message: `Possible LLM hallucination: ${workout.workout_index} "${workout.description}" has distance ${(actualDistance / 1000).toFixed(1)}km, but expected range for ${workout.type} is ${(range.min / 1000).toFixed(1)}-${(range.max / 1000).toFixed(1)}km`
        })
      }
    }
  }

  return warnings
}

const DAY_FIELDS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as const
const REST_TOKENS = ['', '—', '-', 'off', 'rest']

/**
 * Count rest days the template explicitly schedules for a given week. Returns null when
 * the template has no per-day fields for that week (e.g. JD 2Q's Q1/Q2/E_days_distribution
 * structure) — caller should fall back to the global `7 - training_days_per_week`.
 *
 * Recognises two schedule shapes:
 *   - String-per-day (Hansons/Pfitz/Magness): rest = empty/"—"/"OFF"/starts-with-"Rest".
 *   - Object-per-day (HH Advanced via `workouts.{day}`): rest = `type === "rest"`.
 */
function templateRestDaysForWeek(weekEntry: WeekSchedule | undefined): number | null {
  if (!weekEntry) return null

  const nested = weekEntry.workouts
  if (nested && typeof nested === 'object') {
    let known = 0, rest = 0
    for (const d of DAY_FIELDS) {
      const v = nested[d]
      if (!v) continue
      known++
      if ((v.type ?? '').toLowerCase() === 'rest') rest++
    }
    if (known > 0) return rest
  }

  let known = 0, rest = 0
  for (const d of DAY_FIELDS) {
    const v = weekEntry[d]
    if (v === undefined) continue
    known++
    if (typeof v === 'string') {
      const vl = v.trim().toLowerCase()
      if (REST_TOKENS.includes(vl) || vl.startsWith('rest')) rest++
    }
  }
  return known > 0 ? rest : null
}

/**
 * Validate plan-level constraints: weekly totals within ±10% of template's total_km,
 * long-run distances ≤ validation_ranges.long_run.max, and rest-day count not exceeding
 * what the template's own schedule prescribes for that week (falling back to a global
 * `7 - training_days_per_week` when the template has no per-day fields). These are
 * promoted to ERROR severity — the plan should be regenerated or caller should surface
 * them as failures.
 */
export function validatePlanLevelConstraints(
  parsedPlan: ParsedPlan,
  template: FullTemplate,
  trainingPaces?: TrainingPaces | null
): WorkoutValidationWarning[] {
  const errors: WorkoutValidationWarning[] = []
  const longRunCap = template.validation_ranges?.long_run?.max
  const fallbackMaxRest = 7 - template.training_days_per_week

  // Build plan_week → template total_km lookup
  const totalKmByPlanWeek = new Map<number, number>()
  for (const w of template.weekly_schedule ?? []) {
    const pw = w.plan_week ?? w.week
    if (typeof pw === 'number' && typeof w.total_km === 'number') {
      totalKmByPlanWeek.set(pw, w.total_km)
    }
  }

  // Build plan_week → template week entry lookup (for per-week rest budget).
  // Prefers explicit plan_week; falls back to array-position alignment so countdown
  // numbering (Pfitz: 17,16,...,1) still maps weekly_schedule[0] → plan W1.
  const weekEntryByPlanWeek = new Map<number, WeekSchedule>()
  const schedule = template.weekly_schedule ?? []
  for (let i = 0; i < schedule.length; i++) {
    const w = schedule[i]
    const pw = w.plan_week ?? (i + 1)
    weekEntryByPlanWeek.set(pw, w)
  }

  for (const week of parsedPlan.weeks) {
    // 1. Weekly total overshoot
    const templateTotalKm = totalKmByPlanWeek.get(week.week_number)
    if (templateTotalKm !== undefined) {
      let actualMeters = 0
      for (const workout of week.workouts) {
        const d = calculateTotalWorkoutDistance(
          workout.distance_meters,
          workout.type,
          workout.structured_workout,
          trainingPaces
        )
        if (d) actualMeters += d
      }
      const actualKm = actualMeters / 1000
      const lowerBound = templateTotalKm * 0.9
      const upperBound = templateTotalKm * 1.1
      if (actualKm < lowerBound || actualKm > upperBound) {
        errors.push({
          workoutIndex: `W${week.week_number}`,
          weekNumber: week.week_number,
          dayNumber: 0,
          description: `Week ${week.week_number} total`,
          workoutType: 'weekly_total',
          actualDistance: Math.round(actualMeters),
          expectedRange: { min: Math.round(lowerBound * 1000), max: Math.round(upperBound * 1000) },
          message: `Week ${week.week_number} total is ${actualKm.toFixed(1)}km but template specifies ${templateTotalKm}km (±10% → ${lowerBound.toFixed(1)}-${upperBound.toFixed(1)}km)`,
          severity: 'error',
          kind: 'weekly_total',
        })
      }
    }

    // 2. Long-run cap
    if (longRunCap) {
      for (const workout of week.workouts) {
        if (workout.type !== 'long_run') continue
        const d = calculateTotalWorkoutDistance(
          workout.distance_meters,
          workout.type,
          workout.structured_workout,
          trainingPaces
        )
        if (d && d > longRunCap * 1.1) {
          errors.push({
            workoutIndex: workout.workout_index,
            weekNumber: week.week_number,
            dayNumber: workout.day,
            description: workout.description || 'Long run',
            workoutType: 'long_run',
            actualDistance: d,
            expectedRange: { min: 0, max: longRunCap },
            message: `Long run ${workout.workout_index} is ${(d / 1000).toFixed(1)}km but template caps long_run at ${(longRunCap / 1000).toFixed(1)}km`,
            severity: 'error',
            kind: 'long_run_cap',
          })
        }
      }
    }

    // 3. Rest-day overshoot — derive per-week budget from template's own schedule
    const wkEntry = weekEntryByPlanWeek.get(week.week_number)
    const templateRest = templateRestDaysForWeek(wkEntry)
    const maxRestDays = templateRest !== null ? templateRest : fallbackMaxRest
    const restDayCount = week.workouts.filter(w => w.type.toLowerCase() === 'rest').length
    if (restDayCount > maxRestDays) {
      const source = templateRest !== null
        ? `template schedules ${templateRest} rest day${templateRest === 1 ? '' : 's'} for W${week.week_number}`
        : `training_days_per_week=${template.training_days_per_week} → ${fallbackMaxRest} rest day${fallbackMaxRest === 1 ? '' : 's'}`
      errors.push({
        workoutIndex: `W${week.week_number}`,
        weekNumber: week.week_number,
        dayNumber: 0,
        description: `Week ${week.week_number} rest days`,
        workoutType: 'rest',
        actualDistance: restDayCount,
        expectedRange: { min: 0, max: maxRestDays },
        message: `Week ${week.week_number} has ${restDayCount} rest days but ${source}`,
        severity: 'error',
        kind: 'rest_day_overshoot',
      })
    }
  }

  return errors
}

/**
 * Format warnings for display to user
 */
export function formatValidationWarnings(warnings: WorkoutValidationWarning[]): string {
  if (warnings.length === 0) {
    return ''
  }

  const lines = [
    '⚠️  Potential LLM Hallucinations Detected:',
    '',
    ...warnings.map(w =>
      `• ${w.workoutIndex}: "${w.description}" - Distance is ${(w.actualDistance / 1000).toFixed(1)}km (expected ${(w.expectedRange.min / 1000).toFixed(1)}-${(w.expectedRange.max / 1000).toFixed(1)}km for ${w.workoutType})`
    ),
    '',
    'Consider regenerating the plan to get corrected distances.'
  ]

  return lines.join('\n')
}
