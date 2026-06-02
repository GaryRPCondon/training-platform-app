/**
 * AI Coach Tool Definitions
 *
 * Defines the propose_workout tool the coach LLM calls when suggesting
 * a specific workout. Structured workout schema matches the app's internal
 * structured_workout JSONB format, which the Garmin workout mapper reads.
 */

import { ToolDefinition } from './provider-interface'

// Generic fallback vocabulary used only when no active-plan methodology labels
// are available (e.g. athlete has no plan). When a plan IS active, the route
// passes its template pace-target labels (e.g. E/M/T/I/R/R10) so proposals use
// the same labels generation does — which lets resolveActivePlanPace stamp them.
const GENERIC_INTENSITIES = ['easy', 'moderate', 'hard', 'tempo', 'threshold', 'interval', 'recovery']

/**
 * Build the coach tool list. When `paceLabels` (the active plan's template
 * pace-target keys) are provided, the propose_workout tool constrains
 * intensity_target and the structured_workout intensities to those exact
 * labels, so resolved paces stamp correctly and proposals match the plan's
 * methodology vocabulary.
 */
export function buildCoachTools(paceLabels?: string[]): ToolDefinition[] {
    const labels = paceLabels && paceLabels.length > 0 ? paceLabels : GENERIC_INTENSITIES
    const intensityListText = paceLabels && paceLabels.length > 0
        ? `Use these EXACT methodology labels from the athlete's active plan: ${labels.join(', ')}. These resolve to the athlete's actual paces — do not invent generic words or pace strings.`
        : `Valid intensity values: ${labels.join(', ')}.`

    return [
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
                    description: 'Total target distance in meters. Required for non-structured workouts (easy_run, long_run, recovery). Omit when structured_workout is provided — the app calculates distance from the structured parts.'
                },
                duration_target_seconds: {
                    type: 'number',
                    description: 'Target duration in seconds. Omit for distance-based workouts.'
                },
                intensity_target: {
                    type: 'string',
                    enum: labels,
                    description: `The workout's primary intensity label. ${intensityListText} Set this on every quality session so the app can resolve and display the correct pace.`
                },
                structured_workout: {
                    type: 'object',
                    description: `Optional structured breakdown for quality sessions (intervals, tempo).
Use intensity labels — not pace strings — so the app can resolve correct paces from the
athlete's training paces. ${intensityListText}

Every interval — including recovery/rest jogs — MUST keep a distance_meters or
duration_seconds; never emit an interval that has only an intensity (that drops it from
distance and duration totals).

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
                        warmup: {
                            type: 'object',
                            properties: {
                                duration_minutes: { type: 'number' },
                                distance_meters: { type: 'number' },
                                intensity: { type: 'string' }
                            }
                        },
                        main_set: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    repeat: { type: 'number' },
                                    skip_last_recovery: { type: 'boolean' },
                                    intervals: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            properties: {
                                                distance_meters: { type: 'number' },
                                                duration_seconds: { type: 'number' },
                                                duration_minutes: { type: 'number' },
                                                intensity: { type: 'string' },
                                                target_pace: { type: 'string' }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        cooldown: {
                            type: 'object',
                            properties: {
                                duration_minutes: { type: 'number' },
                                distance_meters: { type: 'number' },
                                intensity: { type: 'string' }
                            }
                        },
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
                },
                target_pace_sec_per_km: {
                    type: 'number',
                    description: 'Athlete-specified target pace in seconds per km. Only use when the athlete explicitly provides a pace number (e.g. "I want to run at 5:00/km" → 300). Do not calculate — transcribe what the athlete says.'
                },
                target_pace_min_sec_per_km: {
                    type: 'number',
                    description: 'Faster bound of athlete-specified pace range in seconds per km. Use with target_pace_max_sec_per_km for range targets (e.g. "5:00-6:00/km" → min 300, max 360).'
                },
                target_pace_max_sec_per_km: {
                    type: 'number',
                    description: 'Slower bound of athlete-specified pace range in seconds per km.'
                }
            },
            required: ['scheduled_date', 'workout_type', 'description', 'rationale']
        }
    },
    {
        name: 'modify_strength_session',
        description: `Propose a modified set of exercises for an existing strength or mobility session.
Use this when the athlete asks to substitute exercises (e.g. injury, equipment limits, preference),
add or remove exercises, or change reps/sets/duration on an existing session.

The exercises array is a FULL REPLACEMENT of the session's current exercises — include every exercise
the modified session should contain, not just the ones that change. Order is preserved.

The proposal renders as an editable card the athlete can tweak (edit individual rows, add or remove
exercises) before applying. On apply, the server re-validates every exercise against the catalog and
stamps Garmin support fields automatically — you do NOT need to set those.`,
        parameters: {
            type: 'object',
            properties: {
                session_id: {
                    type: 'number',
                    description: 'The strength session ID to modify. Use the IDs visible in the athlete context.'
                },
                exercises: {
                    type: 'array',
                    description: 'Full replacement list of exercises for the session. Order is preserved.',
                    items: {
                        type: 'object',
                        properties: {
                            display_name: {
                                type: 'string',
                                description: 'Human-readable exercise name (e.g. "Glute Bridge", "Plank", "Hamstring Stretch").'
                            },
                            measurement: {
                                type: 'object',
                                properties: {
                                    type: {
                                        type: 'string',
                                        enum: ['reps', 'duration', 'distance'],
                                        description: 'Measurement family. reps for counted reps, duration for timed holds, distance for distance-based work.'
                                    },
                                    sets: { type: 'number', description: 'Number of sets (>= 1).' },
                                    reps_per_set: { type: 'number', description: 'Required when type=reps.' },
                                    duration_seconds: { type: 'number', description: 'Required when type=duration.' },
                                    distance_meters: { type: 'number', description: 'Required when type=distance.' },
                                    weight_kg: { type: 'number', description: 'Optional, only for type=reps. Omit for bodyweight.' },
                                    rest_seconds: { type: 'number', description: 'Optional rest between sets.' }
                                },
                                required: ['type', 'sets']
                            },
                            notes: {
                                type: 'string',
                                description: 'Optional per-exercise cue or technique note.'
                            }
                        },
                        required: ['display_name', 'measurement']
                    }
                },
                rationale: {
                    type: 'string',
                    description: 'Why you are proposing this modification. Reference the athlete\'s stated constraint (e.g. tight hamstring) and how the substitutions address it.'
                },
                coaching_note: {
                    type: 'string',
                    description: 'Optional short note saved on the session (form cues, what to watch for, etc.).'
                }
            },
            required: ['session_id', 'exercises', 'rationale']
        }
    }
    ]
}

/** Default generic tool list (no active-plan methodology labels). */
export const COACH_TOOLS: ToolDefinition[] = buildCoachTools()

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface StrengthExerciseProposal {
    display_name: string
    measurement: {
        type: 'reps' | 'duration' | 'distance'
        sets: number
        reps_per_set?: number
        duration_seconds?: number
        distance_meters?: number
        weight_kg?: number | null
        rest_seconds?: number
    }
    notes?: string
}

export interface StrengthSessionProposal {
    session_id: number
    exercises: StrengthExerciseProposal[]
    rationale: string
    coaching_note?: string
    /** Set by the UI after the athlete acts on the card */
    proposal_status?: 'pending' | 'applied' | 'dismissed'
}

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
    /** Athlete-specified pace overrides (seconds per km) */
    target_pace_sec_per_km?: number
    target_pace_min_sec_per_km?: number
    target_pace_max_sec_per_km?: number
    /** Set by the UI after the athlete acts on the card */
    proposal_status?: 'pending' | 'applied' | 'dismissed'
}
