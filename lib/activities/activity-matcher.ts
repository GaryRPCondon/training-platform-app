import { Activity } from '@/types/database'

interface MatchResult {
    matchFound: boolean
    confidenceScore: number
    status: 'auto_merged' | 'pending_review' | 'none'
    matchedActivityId?: number
}

export function matchActivities(
    newActivity: Partial<Activity>,
    existingActivities: Activity[]
): MatchResult {
    let bestMatch: Activity | null = null
    let bestScore = 0

    const newTime = new Date(newActivity.start_time!).getTime()
    const newDuration = newActivity.duration_seconds || 0
    const newDistance = newActivity.distance_meters || 0

    for (const existing of existingActivities) {
        // 1. Time Check (must be within 5 minutes)
        const existingTime = new Date(existing.start_time).getTime()
        const timeDiffMinutes = Math.abs(newTime - existingTime) / (1000 * 60)

        if (timeDiffMinutes > 5) continue

        // 2. Calculate Score
        let score = 100

        // Deduct for time difference (up to 10 points)
        score -= Math.min(timeDiffMinutes * 2, 10)

        // Deduct for duration difference (up to 20 points)
        const durationDiff = Math.abs(newDuration - (existing.duration_seconds || 0))
        const durationDiffPct = newDuration > 0 ? durationDiff / newDuration : 0
        score -= Math.min(durationDiffPct * 100, 20)

        // Deduct for distance difference (up to 20 points)
        const distanceDiff = Math.abs(newDistance - (existing.distance_meters || 0))
        const distanceDiffPct = newDistance > 0 ? distanceDiff / newDistance : 0
        score -= Math.min(distanceDiffPct * 100, 20)

        if (score > bestScore) {
            bestScore = score
            bestMatch = existing
        }
    }

    if (bestMatch && bestScore > 90) {
        return {
            matchFound: true,
            confidenceScore: bestScore,
            status: bestScore >= 98 ? 'auto_merged' : 'pending_review',
            matchedActivityId: bestMatch.id
        }
    }

    return {
        matchFound: false,
        confidenceScore: 0,
        status: 'none'
    }
}
