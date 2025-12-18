/**
 * Workout templates for different training phases and workout types
 */

export interface WorkoutTemplate {
    type: 'easy_run' | 'long_run' | 'tempo' | 'intervals' | 'rest' | 'cross_training' | 'recovery' | 'race'
    description: string
    distancePercentage: number // Percentage of weekly volume
    intensity: 'easy' | 'moderate' | 'hard' | 'recovery'
    structuredWorkout?: any
}

export function getWorkoutTemplatesForPhase(phaseName: string): WorkoutTemplate[] {
    const phase = phaseName.toLowerCase()

    if (phase === 'base') {
        return [
            { type: 'easy_run', description: 'Easy aerobic run', distancePercentage: 0.15, intensity: 'easy' },
            { type: 'recovery', description: 'Recovery run', distancePercentage: 0.12, intensity: 'recovery' },
            { type: 'easy_run', description: 'Easy aerobic run', distancePercentage: 0.15, intensity: 'easy' },
            { type: 'easy_run', description: 'Easy run with strides', distancePercentage: 0.13, intensity: 'easy' },
            { type: 'rest', description: 'Rest or cross-training', distancePercentage: 0, intensity: 'easy' },
            { type: 'easy_run', description: 'Easy shakeout run', distancePercentage: 0.10, intensity: 'easy' },
            { type: 'long_run', description: 'Long aerobic run', distancePercentage: 0.35, intensity: 'moderate' },
        ]
    }

    if (phase === 'build') {
        return [
            { type: 'recovery', description: 'Recovery run', distancePercentage: 0.12, intensity: 'recovery' },
            {
                type: 'tempo', description: 'Tempo run', distancePercentage: 0.15, intensity: 'hard',
                structuredWorkout: { warmup: 2000, tempo: 5000, cooldown: 2000 }
            },
            { type: 'easy_run', description: 'Easy aerobic run', distancePercentage: 0.13, intensity: 'easy' },
            {
                type: 'intervals', description: 'Speed intervals', distancePercentage: 0.12, intensity: 'hard',
                structuredWorkout: { warmup: 2000, intervals: { distance: 800, count: 6, recovery: 400 }, cooldown: 2000 }
            },
            { type: 'rest', description: 'Rest or cross-training', distancePercentage: 0, intensity: 'easy' },
            { type: 'easy_run', description: 'Easy shakeout run', distancePercentage: 0.10, intensity: 'easy' },
            { type: 'long_run', description: 'Long run with progression', distancePercentage: 0.38, intensity: 'moderate' },
        ]
    }

    if (phase === 'peak') {
        return [
            { type: 'recovery', description: 'Recovery run', distancePercentage: 0.10, intensity: 'recovery' },
            {
                type: 'tempo', description: 'Marathon pace tempo', distancePercentage: 0.18, intensity: 'hard',
                structuredWorkout: { warmup: 2000, tempo: 8000, cooldown: 2000 }
            },
            { type: 'easy_run', description: 'Easy aerobic run', distancePercentage: 0.12, intensity: 'easy' },
            {
                type: 'intervals', description: 'Race pace intervals', distancePercentage: 0.15, intensity: 'hard',
                structuredWorkout: { warmup: 2000, intervals: { distance: 1600, count: 5, recovery: 400 }, cooldown: 2000 }
            },
            { type: 'rest', description: 'Rest or easy cross-training', distancePercentage: 0, intensity: 'easy' },
            { type: 'easy_run', description: 'Easy shakeout run', distancePercentage: 0.10, intensity: 'easy' },
            { type: 'long_run', description: 'Long run with race pace segments', distancePercentage: 0.35, intensity: 'hard' },
        ]
    }

    // Taper
    return [
        { type: 'recovery', description: 'Recovery run', distancePercentage: 0.20, intensity: 'recovery' },
        { type: 'easy_run', description: 'Easy run with strides', distancePercentage: 0.15, intensity: 'easy' },
        { type: 'rest', description: 'Rest', distancePercentage: 0, intensity: 'easy' },
        { type: 'easy_run', description: 'Easy shakeout with race pace strides', distancePercentage: 0.15, intensity: 'moderate' },
        { type: 'rest', description: 'Rest', distancePercentage: 0, intensity: 'easy' },
        { type: 'easy_run', description: 'Pre-race shakeout', distancePercentage: 0.10, intensity: 'easy' },
        { type: 'rest', description: 'Rest - Race Day Tomorrow!', distancePercentage: 0, intensity: 'easy' },
    ]
}

export function calculateWorkoutDistance(
    template: WorkoutTemplate,
    weeklyVolume: number
): number {
    return Math.round(weeklyVolume * template.distancePercentage * 1000) // Convert to meters
}
