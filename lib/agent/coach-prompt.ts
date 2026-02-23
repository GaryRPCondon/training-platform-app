/**
 * AI Coach System Prompt
 *
 * Formats the CoachContext into a structured system prompt.
 * Designed for readability by the LLM, not for JSON parsing.
 */

import { format } from 'date-fns'
import type { CoachContext } from './coach-context-loader'

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function buildCoachSystemPrompt(context: CoachContext): string {
    const sections: string[] = [
        buildRoleSection(context.athlete.preferred_units),
        buildAthleteSection(context),
        buildPlanSection(context),
        buildThisWeekSection(context),
        buildPhaseExecutionSection(context),
        buildUpcomingWeeksSection(context),
        buildConstraintsSection(context),
        buildFeedbackSection(context),
        buildPersonalRecordsSection(context),
        buildToolInstructionsSection(),
    ]

    return sections.filter(Boolean).join('\n\n')
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function buildRoleSection(units: string): string {
    const paceUnit = units === 'imperial' ? 'min/mi' : 'min/km'
    const distanceUnit = units === 'imperial' ? 'miles' : 'km'

    return `You are an AI running coach for a self-coached endurance athlete.

## Your Role
- Analyse their training data and provide evidence-based, specific advice
- Suggest concrete workouts when appropriate, grounding suggestions in their actual plan and data
- Explain your reasoning — cite specific numbers from their training history
- Be direct. Athletes prefer "your tempo completion rate is 67% — here's why that matters" over generalities

## Boundaries
- Not a medical professional. For any injury, pain, or health concern, always recommend they consult a physiotherapist or sports medicine professional
- Not prescriptive. Suggest and explain; the athlete makes the final call

## Units
All paces in ${paceUnit}, distances in ${distanceUnit}.`
}

function buildAthleteSection(context: CoachContext): string {
    const { athlete } = context
    const lines = ['## Athlete Profile']

    if (athlete.name) lines.push(`Name: ${athlete.name}`)

    if (athlete.vdot) {
        lines.push(`VDOT: ${athlete.vdot}`)
    }

    if (athlete.training_paces) {
        const p = athlete.training_paces
        const paces = [
            `Easy: ${formatPace(p.easy, athlete.preferred_units)}`,
            `Marathon: ${formatPace(p.marathon, athlete.preferred_units)}`,
            `Tempo: ${formatPace(p.tempo, athlete.preferred_units)}`,
            `Interval: ${formatPace(p.interval, athlete.preferred_units)}`,
            `Repetition: ${formatPace(p.repetition, athlete.preferred_units)}`,
        ]
        lines.push(`Training Paces: ${paces.join(' | ')}`)
    }

    return lines.join('\n')
}

function buildPlanSection(context: CoachContext): string {
    const { plan, currentPhase } = context
    if (!plan) return '## Training Plan\nNo active training plan.'

    const lines = ['## Active Plan']
    lines.push(`Plan: ${plan.name}`)
    if (plan.plan_type) lines.push(`Goal: ${plan.plan_type}`)
    lines.push(`Goal Date: ${formatDate(plan.goal_date)} (${plan.weeks_remaining} weeks remaining)`)

    if (currentPhase) {
        lines.push(`Current Phase: ${currentPhase.name} (Week ${currentPhase.current_week} of ${currentPhase.total_weeks})`)
        if (currentPhase.description) lines.push(`Phase Focus: ${currentPhase.description}`)
        if (currentPhase.weekly_volume_target) {
            const km = (currentPhase.weekly_volume_target / 1000).toFixed(0)
            lines.push(`Phase Volume Target: ${km}km/week`)
        }
        if (currentPhase.intensity_distribution) {
            const dist = currentPhase.intensity_distribution
            const formatted = Object.entries(dist)
                .map(([k, v]) => `${k}: ${v}%`)
                .join(', ')
            lines.push(`Phase Intensity Distribution: ${formatted}`)
        }
    }

    return lines.join('\n')
}

function buildThisWeekSection(context: CoachContext): string {
    const { thisWeek } = context
    if (!thisWeek) return ''

    const lines = [`## This Week (${formatDate(thisWeek.week_start)} – ${formatDate(thisWeek.week_end)})`]

    if (thisWeek.volume_target_meters) {
        const km = (thisWeek.volume_target_meters / 1000).toFixed(0)
        lines.push(`Volume Target: ${km}km`)
    }

    if (thisWeek.workouts.length === 0) {
        lines.push('No workouts scheduled.')
        return lines.join('\n')
    }

    for (const w of thisWeek.workouts) {
        const dayName = format(new Date(w.date + 'T12:00:00'), 'EEE d MMM')
        const type = formatWorkoutType(w.workout_type)
        const distance = w.distance_target_meters
            ? ` ${(w.distance_target_meters / 1000).toFixed(1)}km`
            : w.duration_target_seconds
                ? ` ${Math.round(w.duration_target_seconds / 60)}min`
                : ''
        const desc = w.description ? ` — ${w.description}` : ''

        let statusStr = ''
        if (w.completion_status === 'completed') {
            const actual = w.actual_distance_meters
                ? ` (${(w.actual_distance_meters / 1000).toFixed(1)}km completed)`
                : ' (completed)'
            statusStr = `[DONE${actual}]`
        } else if (w.status === 'scheduled' && w.completion_status === 'pending') {
            statusStr = '[scheduled]'
        } else if (w.status === 'skipped' || w.completion_status === 'skipped') {
            statusStr = '[skipped]'
        }

        lines.push(`${dayName}: ${type}${distance}${desc} ${statusStr}`.trim())
    }

    return lines.join('\n')
}

function buildPhaseExecutionSection(context: CoachContext): string {
    const { phaseExecution, currentPhase } = context
    if (!phaseExecution || !currentPhase) return ''

    const lines = [`## Training Execution — ${currentPhase.name} Phase`]

    // By workout type
    const typeEntries = Object.entries(phaseExecution.byType)
    if (typeEntries.length > 0) {
        lines.push('\nBy workout type:')
        for (const [type, stats] of typeEntries) {
            const completionPct = stats.planned_count > 0
                ? Math.round((stats.completed_count / stats.planned_count) * 100)
                : 0
            const plannedKm = (stats.planned_distance_meters / 1000).toFixed(0)
            const completedKm = (stats.completed_distance_meters / 1000).toFixed(0)
            const remaining = stats.remaining_count > 0 ? `, ${stats.remaining_count} remaining` : ''
            lines.push(
                `  ${formatWorkoutType(type)}: ${stats.completed_count}/${stats.planned_count} completed (${completionPct}%) — ${completedKm}km of ${plannedKm}km target${remaining}`
            )
        }
    }

    // Weekly volumes
    if (phaseExecution.weeklyVolumes.length > 0) {
        lines.push('\nWeekly volumes (planned → actual):')
        for (const week of phaseExecution.weeklyVolumes) {
            const planned = (week.planned_meters / 1000).toFixed(0)
            const actual = (week.actual_meters / 1000).toFixed(0)
            const pct = week.planned_meters > 0
                ? Math.round((week.actual_meters / week.planned_meters) * 100)
                : 0
            const weekLabel = formatDate(week.week_start)
            lines.push(`  w/c ${weekLabel}: ${planned}km → ${actual}km (${pct}%, ${week.workouts_completed}/${week.workouts_planned} workouts)`)
        }
    }

    return lines.join('\n')
}

function buildUpcomingWeeksSection(context: CoachContext): string {
    const { upcomingWeeks } = context
    if (upcomingWeeks.length === 0) return ''

    const lines = ['## Upcoming Weeks']

    for (const week of upcomingWeeks) {
        const volumeStr = week.volume_target_meters
            ? ` (${(week.volume_target_meters / 1000).toFixed(0)}km target)`
            : ''
        lines.push(`\n${formatDate(week.week_start)} – ${formatDate(week.week_end)}${volumeStr}`)

        for (const w of week.workouts) {
            const dayName = format(new Date(w.date + 'T12:00:00'), 'EEE d')
            const type = formatWorkoutType(w.workout_type)
            const distance = w.distance_target_meters
                ? ` ${(w.distance_target_meters / 1000).toFixed(1)}km`
                : w.duration_target_seconds
                    ? ` ${Math.round(w.duration_target_seconds / 60)}min`
                    : ''
            const desc = w.description ? ` — ${w.description}` : ''
            lines.push(`  ${dayName}: ${type}${distance}${desc}`)
        }
    }

    return lines.join('\n')
}

function buildConstraintsSection(context: CoachContext): string {
    const { constraints } = context
    if (constraints.length === 0) return ''

    const lines = ['## Athlete Constraints']
    for (const c of constraints) {
        const typeLabel = c.constraint_type.replace(/_/g, ' ')
        lines.push(`- ${typeLabel}${c.description ? ': ' + c.description : ''}`)
    }

    return lines.join('\n')
}

function buildFeedbackSection(context: CoachContext): string {
    const { recentFeedback } = context
    if (recentFeedback.length === 0) return ''

    const lines = ['## Recent Feedback (Last 7 Days)']
    for (const f of recentFeedback) {
        const workout = f.workout_type && f.workout_date
            ? `${formatWorkoutType(f.workout_type)} on ${formatDate(f.workout_date)}`
            : 'Recent workout'
        const parts = []
        if (f.felt_difficulty !== null) parts.push(`difficulty ${f.felt_difficulty}/10`)
        if (f.fatigue_level !== null) parts.push(`fatigue ${f.fatigue_level}/10`)
        if (f.injury_concern) parts.push('⚠️ injury concern flagged')
        if (f.feedback_text) parts.push(`"${f.feedback_text}"`)
        lines.push(`- ${workout}: ${parts.join(', ')}`)
    }

    return lines.join('\n')
}

function buildPersonalRecordsSection(context: CoachContext): string {
    const { personalRecords, athlete } = context
    const entries = Object.entries(personalRecords)
    if (entries.length === 0) return ''

    const lines = ['## Personal Records']
    const labels: Record<string, string> = {
        '5k': '5K',
        '10k': '10K',
        'half_marathon': 'Half Marathon',
        'marathon': 'Marathon',
    }

    for (const [key, pr] of entries) {
        const label = labels[key] ?? key
        const time = formatDuration(pr.seconds)
        const pace = formatPace(pr.pace_per_km, athlete.preferred_units)
        const date = format(new Date(pr.date), 'MMM yyyy')
        lines.push(`${label}: ${time} (${pace}/km) — ${date}`)
    }

    return lines.join('\n')
}

function buildToolInstructionsSection(): string {
    return `## Proposing Workouts
When your advice leads to a specific workout recommendation, use the \`propose_workout\` tool.
The workout will render as a card the athlete can apply to their plan, edit, or dismiss.

When proposing multiple alternatives:
- Mark your top recommendation \`is_preferred: true\`
- Explain in your text response why that option is preferred
- Include \`supersedes_workout_id\` when replacing an existing workout (the athlete chooses whether to remove the old one)

Always include in your text response:
- Why you are suggesting this workout specifically
- Where it fits physiologically in the training week or phase
- Any trade-offs vs the original plan`
}

// ---------------------------------------------------------------------------
// Formatting utilities
// ---------------------------------------------------------------------------

/** Format seconds-per-km into M:SS, adjusted for imperial if needed */
function formatPace(secPerKm: number, units: string): string {
    const secPerUnit = units === 'imperial' ? secPerKm * 1.60934 : secPerKm
    const minutes = Math.floor(secPerUnit / 60)
    const seconds = Math.round(secPerUnit % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/** Format a duration in seconds as H:MM:SS or M:SS */
function formatDuration(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600)
    const m = Math.floor((totalSeconds % 3600) / 60)
    const s = Math.round(totalSeconds % 60)
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    }
    return `${m}:${s.toString().padStart(2, '0')}`
}

/** Format a YYYY-MM-DD date string as "Mon 24 Feb" */
function formatDate(dateStr: string): string {
    return format(new Date(dateStr + 'T12:00:00'), 'd MMM')
}

/** Convert snake_case workout type to Title Case */
function formatWorkoutType(type: string): string {
    return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}
