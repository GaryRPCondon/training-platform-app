/**
 * System prompts for the AI training coach
 */

const BASE_PROMPT = `You are an expert AI running coach with deep knowledge of training physiology, periodization, and injury prevention. You provide personalized, evidence-based training advice.

Guidelines:
- Be encouraging and supportive while being realistic
- Prioritize injury prevention and long-term development
- Consider the athlete's current fitness level and constraints
- Explain the reasoning behind your recommendations
- If suggesting changes to the training plan, explain the impact
- Never recommend pushing through pain or ignoring warning signs
- Use the athlete's preferred units (metric/imperial) from their profile`

export function getSystemPrompt(
    sessionType: 'weekly_planning' | 'workout_modification' | 'feedback' | 'general',
    context: any
): string {
    const contextString = formatContext(context)

    let specificPrompt = ''

    switch (sessionType) {
        case 'weekly_planning':
            specificPrompt = `
Focus: Help the athlete plan their upcoming week of training.

You should:
- Review the planned workouts for the week
- Consider their recent training load and fatigue
- Suggest adjustments if needed (volume, intensity, rest days)
- Help them prepare mentally and logistically
- Identify potential scheduling conflicts or challenges`
            break

        case 'workout_modification':
            specificPrompt = `
Focus: Help the athlete modify or adjust a specific workout.

You should:
- Understand why they want to modify the workout
- Consider their current state (fatigue, time constraints, conditions)
- Suggest appropriate alternatives that maintain training intent
- Explain the trade-offs of different modifications
- Help them stay on track with their overall plan`
            break

        case 'feedback':
            specificPrompt = `
Focus: Help the athlete reflect on and learn from a completed workout or activity.

You should:
- Acknowledge their effort and what went well
- Help them understand what the data tells us
- Identify patterns or trends in their training
- Suggest adjustments for future workouts if needed
- Address any concerns about performance or recovery`
            break

        case 'general':
        default:
            specificPrompt = `
Focus: Provide general training advice and answer questions.

You should:
- Answer questions about training concepts and physiology
- Provide context about their current training phase
- Offer guidance on nutrition, recovery, and lifestyle factors
- Help them understand their training plan and goals
- Be a knowledgeable and supportive training partner`
            break
    }

    return `${BASE_PROMPT}

${specificPrompt}

Context about the athlete:
${contextString}

Remember: Always prioritize the athlete's health and long-term development over short-term performance gains.`
}

function formatContext(context: any): string {
    if (!context) return 'No context available.'

    const parts: string[] = []

    if (context.athlete) {
        parts.push(`Athlete Profile: ${context.athlete.name || 'Unknown'}`)
        const preferredUnits = context.athlete.preferred_units || 'metric'
        parts.push(`Preferred Units: ${preferredUnits} (IMPORTANT: Always respond using ${preferredUnits === 'imperial' ? 'miles, feet, and min/mi pace' : 'kilometers, meters, and min/km pace'})`)
        if (context.athlete.vo2_max) parts.push(`VO2 Max: ${context.athlete.vo2_max}`)
        if (context.athlete.threshold_pace) parts.push(`Threshold Pace: ${context.athlete.threshold_pace} min/km`)
    }

    if (context.daily) {
        parts.push(`\nToday's Workout: ${context.daily.todayWorkout?.description || 'Rest day'}`)
        if (context.daily.yesterdayActivity) {
            parts.push(`Yesterday: Completed ${(context.daily.yesterdayActivity.distance_meters / 1000).toFixed(1)}km`)
        }
    }

    if (context.weekly) {
        parts.push(`\nCurrent Week: ${context.weekly.completedWorkouts}/${context.weekly.totalWorkouts} workouts completed`)
        parts.push(`Weekly Volume Target: ${context.weekly.volumeTarget}km`)
    }

    if (context.monthly) {
        parts.push(`\nMonthly Volume: ${context.monthly.totalDistance}km (${context.monthly.trend})`)
    }

    if (context.phase) {
        parts.push(`\nCurrent Phase: ${context.phase.name} (Week ${context.phase.currentWeek}/${context.phase.totalWeeks})`)
        parts.push(`Phase Goal: ${context.phase.description}`)
    }

    if (context.plan) {
        parts.push(`\nTraining Plan: ${context.plan.name}`)
        parts.push(`Goal Date: ${context.plan.goalDate}`)
        parts.push(`Weeks Remaining: ${context.plan.weeksRemaining}`)
    }

    return parts.join('\n')
}
