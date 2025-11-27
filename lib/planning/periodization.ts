/**
 * Periodization utilities for training plan generation
 */

export interface PhaseConfig {
    name: string
    percentage: number // Percentage of total training weeks
    volumeMultiplier: number // Relative to max volume
    description: string
}

export const PHASE_CONFIGS: PhaseConfig[] = [
    { name: 'Base', percentage: 0.30, volumeMultiplier: 0.7, description: 'Build aerobic base with easy miles' },
    { name: 'Build', percentage: 0.50, volumeMultiplier: 0.85, description: 'Increase volume and add quality work' },
    { name: 'Peak', percentage: 0.10, volumeMultiplier: 1.0, description: 'Race-specific workouts at peak volume' },
    { name: 'Taper', percentage: 0.10, volumeMultiplier: 0.5, description: 'Reduce volume, maintain intensity' }
]

export function calculatePhaseWeeks(totalWeeks: number): { name: string; weeks: number }[] {
    const phases = []
    let remainingWeeks = totalWeeks

    for (let i = 0; i < PHASE_CONFIGS.length - 1; i++) {
        const weeks = Math.floor(totalWeeks * PHASE_CONFIGS[i].percentage)
        phases.push({ name: PHASE_CONFIGS[i].name, weeks })
        remainingWeeks -= weeks
    }

    // Last phase gets remaining weeks
    phases.push({ name: PHASE_CONFIGS[PHASE_CONFIGS.length - 1].name, weeks: remainingWeeks })

    return phases
}

export function calculateWeeklyVolume(
    weekNumber: number,
    totalWeeksInPhase: number,
    phaseMultiplier: number,
    maxVolume: number,
    currentVolume: number
): number {
    // Check if this is a recovery week (every 4th week)
    const isRecoveryWeek = weekNumber % 4 === 0

    if (isRecoveryWeek) {
        // Recovery week: 70-80% of normal volume
        const normalVolume = calculateNormalVolume(weekNumber, totalWeeksInPhase, phaseMultiplier, maxVolume, currentVolume)
        return normalVolume * 0.75
    }

    return calculateNormalVolume(weekNumber, totalWeeksInPhase, phaseMultiplier, maxVolume, currentVolume)
}

function calculateNormalVolume(
    weekNumber: number,
    totalWeeksInPhase: number,
    phaseMultiplier: number,
    maxVolume: number,
    currentVolume: number
): number {
    // Linear progression within phase
    const progressionFactor = weekNumber / totalWeeksInPhase
    const targetVolume = maxVolume * phaseMultiplier

    // Interpolate between current and target
    return currentVolume + (targetVolume - currentVolume) * progressionFactor
}

export interface IntensityDistribution {
    easy: number // Percentage
    moderate: number
    hard: number
}

export function getIntensityDistribution(phaseName: string): IntensityDistribution {
    switch (phaseName.toLowerCase()) {
        case 'base':
            return { easy: 90, moderate: 10, hard: 0 }
        case 'build':
            return { easy: 70, moderate: 20, hard: 10 }
        case 'peak':
            return { easy: 60, moderate: 25, hard: 15 }
        case 'taper':
            return { easy: 80, moderate: 15, hard: 5 }
        default:
            return { easy: 80, moderate: 15, hard: 5 }
    }
}
