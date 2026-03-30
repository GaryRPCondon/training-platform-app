/**
 * Preview generation — shows before/after state for operations
 */

import type { FullPlanContext } from '@/lib/chat/plan-context-loader'
import type { PlanOperation, OperationPreview } from './types'
import { describeOperation } from './describe'
import {
  parseWorkoutIndex,
  findWorkoutByIndex,
  calculateNewDate,
  getWorkoutTypeDefaults,
} from './helpers'

/**
 * Generate preview of operations showing before/after state
 *
 * This allows users to review changes before applying.
 * For multiple operations on the same workout, this merges them into a single
 * before/after preview showing the cumulative effect.
 */
export function previewOperations(
  operations: PlanOperation[],
  planContext: FullPlanContext
): OperationPreview[] {
  const previews: OperationPreview[] = []

  for (const op of operations) {
    const preview: OperationPreview = {
      operation: op,
      description: describeOperation(op),
      affectedWorkouts: []
    }

    switch (op.op) {
      case 'swap_days': {
        const targetWeeks = op.weekNumbers === 'all'
          ? planContext.weeks
          : planContext.weeks.filter(w => (op.weekNumbers as number[]).includes(w.week_number))

        for (const week of targetWeeks) {
          const workoutA = week.workouts.find(w => w.day === op.dayA)
          const workoutB = week.workouts.find(w => w.day === op.dayB)

          if (workoutA) {
            const newDateA = calculateNewDate(week.week_start_date, op.dayB)
            preview.affectedWorkouts.push({
              workoutId: 0,
              weekNumber: week.week_number,
              day: op.dayA,
              before: {
                date: workoutA.scheduled_date,
                type: workoutA.workout_type,
                description: workoutA.description,
                distanceKm: workoutA.distance_km
              },
              after: {
                date: newDateA,
                type: workoutA.workout_type,
                description: workoutA.description,
                distanceKm: workoutA.distance_km
              }
            })
          }

          if (workoutB) {
            const newDateB = calculateNewDate(week.week_start_date, op.dayA)
            preview.affectedWorkouts.push({
              workoutId: 0,
              weekNumber: week.week_number,
              day: op.dayB,
              before: {
                date: workoutB.scheduled_date,
                type: workoutB.workout_type,
                description: workoutB.description,
                distanceKm: workoutB.distance_km
              },
              after: {
                date: newDateB,
                type: workoutB.workout_type,
                description: workoutB.description,
                distanceKm: workoutB.distance_km
              }
            })
          }
        }
        break
      }

      case 'move_workout_type': {
        const targetWeeks = op.weekNumbers === 'all'
          ? planContext.weeks
          : planContext.weeks.filter(w => (op.weekNumbers as number[]).includes(w.week_number))

        for (const week of targetWeeks) {
          const matchingWorkout = week.workouts.find(w => w.workout_type === op.workoutType)
          const targetDayWorkout = week.workouts.find(w => w.day === op.toDay)

          if (matchingWorkout && matchingWorkout.day !== op.toDay) {
            const newDate = calculateNewDate(week.week_start_date, op.toDay)
            preview.affectedWorkouts.push({
              workoutId: 0,
              weekNumber: week.week_number,
              day: matchingWorkout.day,
              before: {
                date: matchingWorkout.scheduled_date,
                type: matchingWorkout.workout_type,
                description: matchingWorkout.description,
                distanceKm: matchingWorkout.distance_km
              },
              after: {
                date: newDate,
                type: matchingWorkout.workout_type,
                description: matchingWorkout.description,
                distanceKm: matchingWorkout.distance_km
              }
            })

            if (targetDayWorkout) {
              const swapDate = calculateNewDate(week.week_start_date, matchingWorkout.day)
              preview.affectedWorkouts.push({
                workoutId: 0,
                weekNumber: week.week_number,
                day: targetDayWorkout.day,
                before: {
                  date: targetDayWorkout.scheduled_date,
                  type: targetDayWorkout.workout_type,
                  description: targetDayWorkout.description,
                  distanceKm: targetDayWorkout.distance_km
                },
                after: {
                  date: swapDate,
                  type: targetDayWorkout.workout_type,
                  description: targetDayWorkout.description,
                  distanceKm: targetDayWorkout.distance_km
                }
              })
            }
          }
        }
        break
      }

      case 'scale_week_volume': {
        const week = planContext.weeks.find(w => w.week_number === op.weekNumber)
        if (week) {
          for (const workout of week.workouts) {
            if (workout.distance_km && workout.workout_type !== 'rest') {
              const newDistance = workout.distance_km * op.factor
              preview.affectedWorkouts.push({
                workoutId: 0,
                weekNumber: week.week_number,
                day: workout.day,
                before: {
                  date: workout.scheduled_date,
                  type: workout.workout_type,
                  description: workout.description,
                  distanceKm: workout.distance_km
                },
                after: {
                  date: workout.scheduled_date,
                  type: workout.workout_type,
                  description: workout.description,
                  distanceKm: parseFloat(newDistance.toFixed(1))
                }
              })
            }
          }
        }
        break
      }

      case 'remove_workout_type': {
        const targetWeeks = op.weekNumbers === 'all'
          ? planContext.weeks
          : planContext.weeks.filter(w => (op.weekNumbers as number[]).includes(w.week_number))

        for (const week of targetWeeks) {
          for (const workout of week.workouts) {
            if (workout.workout_type === op.workoutType) {
              preview.affectedWorkouts.push({
                workoutId: 0,
                weekNumber: week.week_number,
                day: workout.day,
                before: {
                  date: workout.scheduled_date,
                  type: workout.workout_type,
                  description: workout.description,
                  distanceKm: workout.distance_km
                },
                after: {
                  date: workout.scheduled_date,
                  type: op.replacement,
                  description: workout.description,
                  distanceKm: workout.distance_km
                }
              })
            }
          }
        }
        break
      }

      case 'change_workout_type':
      case 'change_workout_distance':
      case 'scale_workout_distance':
      case 'reschedule_workout': {
        const workoutIndex = (op as any).workoutIndex
        if (!workoutIndex) break

        const parsed = parseWorkoutIndex(workoutIndex)
        if (!parsed) break

        const found = findWorkoutByIndex(workoutIndex, planContext)

        if (found) {
          const { week, workout } = found

          const before = {
            date: workout.scheduled_date,
            type: workout.workout_type,
            description: workout.description,
            distanceKm: workout.distance_km
          }

          const after = { ...before }

          if (op.op === 'change_workout_type') {
            const newType = (op as any).newType
            after.type = newType
            const defaults = getWorkoutTypeDefaults(newType, workout.distance_km)
            if (defaults.description) after.description = defaults.description
            if (defaults.distance_target_meters !== undefined) {
              after.distanceKm = defaults.distance_target_meters / 1000
            }
          } else if (op.op === 'change_workout_distance') {
            after.distanceKm = (op as any).newDistanceMeters / 1000
          } else if (op.op === 'scale_workout_distance') {
            after.distanceKm = (workout.distance_km || 0) * (op as any).factor
          } else if (op.op === 'reschedule_workout') {
            after.date = (op as any).newDate
          }

          preview.affectedWorkouts.push({
            workoutId: 0,
            weekNumber: week.week_number,
            day: workout.day,
            before,
            after
          })
        } else {
          const week = planContext.weeks.find(w => w.week_number === parsed.weekNumber)
          if (!week) break

          const scheduledDate = calculateNewDate(week.week_start_date, parsed.dayNumber)

          const before = {
            date: scheduledDate,
            type: 'rest',
            description: 'Empty',
            distanceKm: null as number | null
          }

          const after = {
            date: scheduledDate,
            type: 'rest',
            description: 'Rest day',
            distanceKm: null as number | null
          }

          if (op.op === 'change_workout_type') {
            after.type = (op as any).newType
            after.description = (op as any).newDescription || `${(op as any).newType} workout`
          } else if (op.op === 'change_workout_distance') {
            after.distanceKm = (op as any).newDistanceMeters / 1000
          } else if (op.op === 'reschedule_workout') {
            after.date = (op as any).newDate
          }

          preview.affectedWorkouts.push({
            workoutId: 0,
            weekNumber: week.week_number,
            day: parsed.dayNumber,
            before,
            after
          })
        }
        break
      }
    }

    previews.push(preview)
  }

  return mergeWorkoutPreviews(previews)
}

/**
 * Merge previews for operations targeting the same workout
 */
function mergeWorkoutPreviews(previews: OperationPreview[]): OperationPreview[] {
  const workoutMap = new Map<string, {
    workoutId: number
    weekNumber: number
    day: number
    before: {
      date: string
      type: string
      description: string
      distanceKm: number | null
    }
    after: {
      date: string
      type: string
      description: string
      distanceKm: number | null
    }
    operations: PlanOperation[]
  }>()

  for (const preview of previews) {
    for (const affected of preview.affectedWorkouts) {
      const key = `W${affected.weekNumber}:D${affected.day}`

      const existing = workoutMap.get(key)
      if (!existing) {
        workoutMap.set(key, {
          ...affected,
          operations: [preview.operation]
        })
      } else {
        const merged = { ...existing }

        if (affected.after.date !== existing.after.date) {
          merged.after.date = affected.after.date
        }
        if (affected.after.type !== existing.before.type) {
          merged.after.type = affected.after.type
        }
        if (affected.after.description !== existing.before.description) {
          merged.after.description = affected.after.description
        }
        if (affected.after.distanceKm !== null && affected.after.distanceKm !== existing.before.distanceKm) {
          merged.after.distanceKm = affected.after.distanceKm
        }

        merged.operations.push(preview.operation)
        workoutMap.set(key, merged)
      }
    }
  }

  const mergedPreviews: OperationPreview[] = []

  for (const preview of previews) {
    const affectedWorkouts = preview.affectedWorkouts
      .map(w => {
        const key = `W${w.weekNumber}:D${w.day}`
        return workoutMap.get(key)
      })
      .filter((w): w is NonNullable<typeof w> => {
        if (!w) return false
        return w.operations[0] === preview.operation
      })

    if (affectedWorkouts.length > 0) {
      mergedPreviews.push({
        operation: preview.operation,
        description: preview.description,
        affectedWorkouts: affectedWorkouts.map(w => ({
          workoutId: w.workoutId,
          weekNumber: w.weekNumber,
          day: w.day,
          before: w.before,
          after: w.after
        }))
      })
    }
  }

  return mergedPreviews
}
