import { differenceInMinutes } from 'date-fns'

export interface Activity {
    id?: number
    start_time: string
    duration_seconds: number
    distance_meters: number
    source?: string
    garmin_id?: string | null
    strava_id?: string | null
}

export interface MergeCandidate {
    activity1: Activity
    activity2: Activity
    confidence: 'high' | 'medium' | 'low'
    confidenceScore: number
    timeDiffMinutes: number
    distanceDiffPercent: number
    durationDiffPercent: number
}

/**
 * Find matching activities between two sources
 * Match criteria:
 * - Time within 2 minutes
 * - Distance within 0.5%
 * - Duration within 1%
 */
export function findMergeCandidates(
    newActivity: Activity,
    existingActivities: Activity[]
): MergeCandidate | null {
    for (const existing of existingActivities) {
        // Skip if same source
        if (newActivity.source === existing.source) continue

        // Skip if already merged
        if (existing.garmin_id && existing.strava_id) continue

        const timeDiff = Math.abs(
            differenceInMinutes(
                new Date(newActivity.start_time),
                new Date(existing.start_time)
            )
        )

        // Must be within 2 minutes
        if (timeDiff > 2) continue

        const distanceDiff = Math.abs(
            (newActivity.distance_meters - existing.distance_meters) / existing.distance_meters
        ) * 100

        const durationDiff = Math.abs(
            (newActivity.duration_seconds - existing.duration_seconds) / existing.duration_seconds
        ) * 100

        // Calculate confidence score (0-100)
        let score = 100
        score -= timeDiff * 10 // -10 per minute difference
        score -= distanceDiff * 20 // -20 per 1% distance difference
        score -= durationDiff * 10 // -10 per 1% duration difference

        // Determine confidence level
        let confidence: 'high' | 'medium' | 'low'
        if (score >= 90 && distanceDiff <= 0.5 && durationDiff <= 1) {
            confidence = 'high'
        } else if (score >= 70 && distanceDiff <= 2 && durationDiff <= 3) {
            confidence = 'medium'
        } else if (score >= 50) {
            confidence = 'low'
        } else {
            continue // Not a match
        }

        return {
            activity1: newActivity,
            activity2: existing,
            confidence,
            confidenceScore: Math.max(0, Math.min(100, score)),
            timeDiffMinutes: timeDiff,
            distanceDiffPercent: distanceDiff,
            durationDiffPercent: durationDiff
        }
    }

    return null
}

/**
 * Determine if activities should be auto-merged
 */
export function shouldAutoMerge(candidate: MergeCandidate): boolean {
    return candidate.confidence === 'high'
}
