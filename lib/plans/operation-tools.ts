import type { ToolDefinition } from '@/lib/agent/provider-interface'

/**
 * Tool definitions for training plan operations
 *
 * These tools allow LLMs to express plan modifications in a structured way
 * that guarantees schema compliance across all providers.
 */
export const OPERATION_TOOLS: ToolDefinition[] = [
  {
    name: 'swap_days',
    description: 'Swap workouts between two days across specified weeks',
    parameters: {
      type: 'object',
      properties: {
        weekNumbers: {
          oneOf: [
            { type: 'array', items: { type: 'number' }, description: 'Specific week numbers' },
            { type: 'string', enum: ['all'], description: 'All weeks in the plan' }
          ],
          description: 'Week numbers to apply swap, or "all" for all weeks'
        },
        dayA: {
          type: 'number',
          minimum: 1,
          maximum: 7,
          description: 'First day number (1-7 relative to week start)'
        },
        dayB: {
          type: 'number',
          minimum: 1,
          maximum: 7,
          description: 'Second day number (1-7 relative to week start)'
        }
      },
      required: ['weekNumbers', 'dayA', 'dayB'],
      additionalProperties: false
    }
  },
  {
    name: 'move_workout_type',
    description: 'Move all workouts of a specific type to a target day across specified weeks',
    parameters: {
      type: 'object',
      properties: {
        workoutType: {
          type: 'string',
          description: 'The workout type to move (e.g., "long_run", "rest", "tempo")'
        },
        toDay: {
          type: 'number',
          minimum: 1,
          maximum: 7,
          description: 'Target day number (1-7 relative to week start)'
        },
        weekNumbers: {
          oneOf: [
            { type: 'array', items: { type: 'number' } },
            { type: 'string', enum: ['all'] }
          ],
          description: 'Week numbers to apply change, or "all" for all weeks'
        }
      },
      required: ['workoutType', 'toDay', 'weekNumbers'],
      additionalProperties: false
    }
  },
  {
    name: 'reschedule_workout',
    description: 'Move a specific workout to a new date',
    parameters: {
      type: 'object',
      properties: {
        workoutIndex: {
          type: 'string',
          pattern: '^W\\d+:D\\d+$',
          description: 'Workout index like "W14:D6" (Week 14, Day 6)'
        },
        newDate: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description: 'New date in YYYY-MM-DD format'
        }
      },
      required: ['workoutIndex', 'newDate'],
      additionalProperties: false
    }
  },
  {
    name: 'change_workout_type',
    description: 'Change a specific workout\'s type (e.g., to rest, race, tempo)',
    parameters: {
      type: 'object',
      properties: {
        workoutIndex: {
          type: 'string',
          pattern: '^W\\d+:D\\d+$',
          description: 'Workout index like "W14:D6"'
        },
        newType: {
          type: 'string',
          enum: ['rest', 'recovery', 'easy', 'easy_run', 'long_run', 'progression', 'tempo', 'intervals', 'speed', 'race', 'cross_training'],
          description: 'New workout type'
        },
        newDescription: {
          type: 'string',
          description: 'Optional new description for the workout'
        }
      },
      required: ['workoutIndex', 'newType'],
      additionalProperties: false
    }
  },
  {
    name: 'change_workout_distance',
    description: 'Change a specific workout\'s target distance',
    parameters: {
      type: 'object',
      properties: {
        workoutIndex: {
          type: 'string',
          pattern: '^W\\d+:D\\d+$',
          description: 'Workout index like "W14:D6"'
        },
        newDistanceMeters: {
          type: 'number',
          minimum: 0,
          description: 'New distance in meters'
        }
      },
      required: ['workoutIndex', 'newDistanceMeters'],
      additionalProperties: false
    }
  },
  {
    name: 'scale_workout_distance',
    description: 'Scale a specific workout\'s distance by a factor',
    parameters: {
      type: 'object',
      properties: {
        workoutIndex: {
          type: 'string',
          pattern: '^W\\d+:D\\d+$',
          description: 'Workout index like "W14:D6"'
        },
        factor: {
          type: 'number',
          minimum: 0,
          maximum: 3,
          description: 'Scaling factor (e.g., 0.8 for 80%, 1.2 for 120%)'
        }
      },
      required: ['workoutIndex', 'factor'],
      additionalProperties: false
    }
  },
  {
    name: 'change_intensity',
    description: 'Change a specific workout\'s intensity level',
    parameters: {
      type: 'object',
      properties: {
        workoutIndex: {
          type: 'string',
          pattern: '^W\\d+:D\\d+$',
          description: 'Workout index like "W14:D6"'
        },
        newIntensity: {
          type: 'string',
          enum: ['easy', 'moderate', 'hard'],
          description: 'New intensity level'
        }
      },
      required: ['workoutIndex', 'newIntensity'],
      additionalProperties: false
    }
  },
  {
    name: 'remove_workout_type',
    description: 'Replace all workouts of one type with another type across specified weeks',
    parameters: {
      type: 'object',
      properties: {
        workoutType: {
          type: 'string',
          description: 'The workout type to remove'
        },
        replacement: {
          type: 'string',
          enum: ['rest', 'recovery', 'easy', 'easy_run', 'long_run', 'progression', 'tempo', 'intervals', 'speed', 'race', 'cross_training'],
          description: 'The workout type to replace it with'
        },
        weekNumbers: {
          oneOf: [
            { type: 'array', items: { type: 'number' } },
            { type: 'string', enum: ['all'] }
          ],
          description: 'Week numbers to apply change, or "all" for all weeks'
        }
      },
      required: ['workoutType', 'replacement', 'weekNumbers'],
      additionalProperties: false
    }
  },
  {
    name: 'scale_week_volume',
    description: 'Scale all workout distances in a specific week by a factor',
    parameters: {
      type: 'object',
      properties: {
        weekNumber: {
          type: 'number',
          minimum: 1,
          description: 'Week number to scale'
        },
        factor: {
          type: 'number',
          minimum: 0,
          maximum: 3,
          description: 'Scaling factor (e.g., 0.8 for 80%, 1.2 for 120%)'
        }
      },
      required: ['weekNumber', 'factor'],
      additionalProperties: false
    }
  },
  {
    name: 'scale_phase_volume',
    description: 'Scale all workout distances in a specific phase by a factor',
    parameters: {
      type: 'object',
      properties: {
        phaseName: {
          type: 'string',
          description: 'Phase name (e.g., "Base", "Build", "Peak", "Taper")'
        },
        factor: {
          type: 'number',
          minimum: 0,
          maximum: 3,
          description: 'Scaling factor (e.g., 0.8 for 80%, 1.2 for 120%)'
        }
      },
      required: ['phaseName', 'factor'],
      additionalProperties: false
    }
  },
  {
    name: 'request_fallback',
    description: 'Request full plan regeneration when the change is too complex to express with operations',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Explanation of why fallback is needed'
        }
      },
      required: ['reason'],
      additionalProperties: false
    }
  }
]
