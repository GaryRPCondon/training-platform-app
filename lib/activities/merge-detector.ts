import { differenceInMinutes, differenceInHours, isSameDay } from 'date-fns'

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

        const date1 = new Date(newActivity.start_time)
        const date2 = new Date(existing.start_time)

        // Check if either activity is "date only" (midnight)
        // We assume if hours/minutes/seconds are 0, it might be date-only from Strava MCP
        const isDateOnly1 = date1.getHours() === 0 && date1.getMinutes() === 0 && date1.getSeconds() === 0
        const isDateOnly2 = date2.getHours() === 0 && date2.getMinutes() === 0 && date2.getSeconds() === 0
        const isDateOnlyMatch = isDateOnly1 || isDateOnly2

        let timeDiff = 0
        if (isDateOnlyMatch) {
            // If date-only, we check if they are within 24 hours to account for timezone differences
            // e.g. Garmin is 27th 23:00 UTC, Strava is 28th (local time)
            const hoursDiff = Math.abs(differenceInHours(date1, date2))
            if (hoursDiff > 24) continue

            // Time diff is effectively 0 for scoring purposes if within window
            timeDiff = 0
        } else {
            timeDiff = Math.abs(differenceInMinutes(date1, date2))
            // Must be within 2 minutes for precise matches
            //            if (timeDiff > 2) continue  - GC:Removing as it is penalizing timezone differences
        }

        // Special handling for zero-distance activities (weight training, yoga, etc.)
        const isZeroDistance = (newActivity.distance_meters === 0 || !newActivity.distance_meters) &&
            (existing.distance_meters === 0 || !existing.distance_meters)

        let distanceDiff = 0
        if (isZeroDistance) {
            distanceDiff = 0  // Perfect match for zero-distance activities
        } else {
            distanceDiff = Math.abs(
                (newActivity.distance_meters - existing.distance_meters) / existing.distance_meters
            ) * 100
        }

        // Duration might be null/0 for Strava date-only imports
        let durationDiff = 0
        if (newActivity.duration_seconds && existing.duration_seconds) {
            durationDiff = Math.abs(
                (newActivity.duration_seconds - existing.duration_seconds) / existing.duration_seconds
            ) * 100
        }

        // Calculate confidence score (0-100)
        let score = 100
        score -= Math.min(timeDiff * 0.1, 20) // GC: Trying to fix up matching - Cap time penalty at 20 points max
        score -= distanceDiff * 20

        if (newActivity.duration_seconds && existing.duration_seconds) {
            score -= durationDiff * 10 // -10 per 1% duration difference
        }

        // Determine confidence level
        let confidence: 'high' | 'medium' | 'low'

        if (isDateOnlyMatch) {
            // Stricter distance requirements for date-only matches since we lack time precision
            // Relaxed to 5% per user request until better metadata is available
            if (score >= 90 && distanceDiff <= 5) {
                confidence = 'high'
            } else if (score >= 70 && distanceDiff <= 1) {
                confidence = 'medium'
            } else if (score >= 50) {
                confidence = 'low'
            } else {
                continue
            }
        } else {
            // Standard precise matching
            if (score >= 90 && distanceDiff <= 0.5 && durationDiff <= 1) {
                confidence = 'high'
            } else if (score >= 70 && distanceDiff <= 2 && durationDiff <= 3) {
                confidence = 'medium'
            } else if (score >= 50) {
                confidence = 'low'
            } else {
                continue // Not a match
            }
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
