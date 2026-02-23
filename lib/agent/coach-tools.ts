/**
 * AI Coach Tool Definitions
 *
 * Defines the propose_workout tool the coach LLM calls when suggesting
 * a specific workout. Structured workout schema matches the app's internal
 * structured_workout JSONB format, which the Garmin workout mapper reads.
 */

import { ToolDefinition } from './provider-interface'

export const COACH_TOOLS: ToolDefinition[] = [
    {
        name: 'propose_workout',
        description: `Propose a specific workout for the athlete to review and optionally add to their plan.
Use this when your advice leads to a concrete workout recommendation.
The workout will render as an interactive card the athlete can apply, edit, or dismiss.
You may call this multiple times to propose alternatives.`,
        parameters: {
            type: 'object',
            properties: {
                scheduled_date: {
                    type: 'string',
                    description: 'ISO date (YYYY-MM-DD) for when this workout should be scheduled.'
                },
                workout_type: {
                    type: 'string',
                    enum: ['easy_run', 'long_run', 'intervals', 'tempo', 'rest', 'cross_training', 'recovery', 'race'],
                    description: 'Type of workout.'
                },
                description: {
                    type: 'string',
                    description: 'Short human-readable title, e.g. "Easy aerobic run" or "6×800m intervals".'
                },
                distance_target_meters: {
                    type: 'number',
                    description: 'Target distance in meters. Omit for time-based workouts.'
                },
                duration_target_seconds: {
                    type: 'number',
                    description: 'Target duration in seconds. Omit for distance-based workouts.'
                },
                intensity_target: {
                    type: 'string',
                    enum: ['easy', 'moderate', 'hard', 'tempo', 'threshold', 'interval', 'recovery'],
                    description: 'Overall intensity level for the workout.'
                },
                structured_workout: {
                    type: 'object',
                    description: `Optional structured breakdown for quality sessions (intervals, tempo).
Use intensity labels — not pace strings — so the app can resolve correct paces from the
athlete's training paces. Valid intensity values: easy, recovery, marathon, moderate,
tempo, threshold, interval, hard, repetition.

For optional target_pace fields use "M:SS/km" (single pace) or "M:SS-M:SS/km" (range,
faster-slower). Only include target_pace when you want to override the intensity-derived pace.

Schema:
{
  "warmup": {
    "duration_minutes": 15,        // or distance_meters
    "intensity": "easy"
  },
  "main_set": [
    {
      "repeat": 6,
      "skip_last_recovery": true,
      "intervals": [
        { "distance_meters": 800, "intensity": "interval" },
        { "duration_seconds": 90, "intensity": "recovery" }
      ]
    }
  ],
  "cooldown": {
    "duration_minutes": 10,
    "intensity": "easy"
  },
  "pace_guidance": "800m reps at 5K pace, jog recoveries",
  "notes": "Focus on consistent splits, not pace."
}

For tempo runs use a single main_set repeat with repeat:1.
For easy/long runs, omit structured_workout entirely.`,
                    properties: {
                        warmup: { type: 'object' },
                        main_set: { type: 'array' },
                        cooldown: { type: 'object' },
                        pace_guidance: { type: 'string' },
                        notes: { type: 'string' }
                    }
                },
                rationale: {
                    type: 'string',
                    description: 'Why you are proposing this specific workout. Reference the athlete\'s data.'
                },
                is_preferred: {
                    type: 'boolean',
                    description: 'Set to true on your single preferred option when proposing multiple alternatives. Only one proposal per response should be marked preferred.'
                },
                supersedes_workout_id: {
                    type: 'number',
                    description: 'If this workout is intended to replace an existing planned workout, provide that workout\'s ID. The UI will offer to remove the old workout after applying the new one, but the athlete decides.'
                }
            },
            required: ['scheduled_date', 'workout_type', 'description', 'rationale']
        }
    }
]

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface WorkoutProposal {
    scheduled_date: string
    workout_type: string
    description: string
    distance_target_meters?: number
    duration_target_seconds?: number
    intensity_target?: string
    structured_workout?: Record<string, unknown>
    rationale: string
    is_preferred?: boolean
    supersedes_workout_id?: number
    /** Set by the UI after the athlete acts on the card */
    proposal_status?: 'pending' | 'applied' | 'dismissed'
}
