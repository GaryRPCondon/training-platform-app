/**
 * Workout Reference Parser
 *
 * Extracts workout references (W#:D# format) from user messages.
 * Used to identify which specific workouts the user is referring to.
 *
 * Examples:
 * - "Change W4:D2 to 10km" → extracts { week: 4, day: 2, index: "W4:D2" }
 * - "Move W12:D3 and W12:D5 to next week" → extracts both references
 * - "Week 5 Day 3" → extracts { week: 5, day: 3, index: "W5:D3" }
 */

export interface WorkoutReference {
  /** Original text that matched (e.g., "W4:D2") */
  original: string
  /** Week number (1-indexed) */
  week: number
  /** Day number within week (1-7) */
  day: number
  /** Standardized index format (W#:D#) */
  index: string
}

/**
 * Parse workout references from user text
 *
 * Supports multiple formats:
 * - W#:D# (e.g., "W4:D2")
 * - "Week # Day #" (e.g., "Week 4 Day 2")
 * - Case-insensitive
 * - Handles multiple references in one message
 *
 * @param text - User message to parse
 * @returns Array of workout references found (empty if none)
 *
 * @example
 * parseWorkoutReferences("Change W4:D2 to 12km")
 * // Returns: [{ original: "W4:D2", week: 4, day: 2, index: "W4:D2" }]
 *
 * @example
 * parseWorkoutReferences("Move Week 5 Day 3 to Friday")
 * // Returns: [{ original: "Week 5 Day 3", week: 5, day: 3, index: "W5:D3" }]
 *
 * @example
 * parseWorkoutReferences("Swap W3:D1 and W3:D4")
 * // Returns: [
 * //   { original: "W3:D1", week: 3, day: 1, index: "W3:D1" },
 * //   { original: "W3:D4", week: 3, day: 4, index: "W3:D4" }
 * // ]
 */
export function parseWorkoutReferences(text: string): WorkoutReference[] {
  const references: WorkoutReference[] = []
  const seen = new Set<string>() // Prevent duplicates

  // Pattern 1: W#:D# format (case-insensitive)
  // Matches: W4:D2, w12:d3, W1:D7, etc.
  const pattern1 = /w(\d+):d(\d+)/gi
  let match: RegExpExecArray | null

  while ((match = pattern1.exec(text)) !== null) {
    const week = parseInt(match[1], 10)
    const day = parseInt(match[2], 10)
    const index = `W${week}:D${day}`

    if (!seen.has(index)) {
      references.push({
        original: match[0],
        week,
        day,
        index
      })
      seen.add(index)
    }
  }

  // Pattern 2: "Week # Day #" format (case-insensitive)
  // Matches: "Week 4 Day 2", "week 12 day 3", etc.
  const pattern2 = /week\s+(\d+)\s+day\s+(\d+)/gi

  while ((match = pattern2.exec(text)) !== null) {
    const week = parseInt(match[1], 10)
    const day = parseInt(match[2], 10)
    const index = `W${week}:D${day}`

    if (!seen.has(index)) {
      references.push({
        original: match[0],
        week,
        day,
        index
      })
      seen.add(index)
    }
  }

  return references
}

/**
 * Validate workout reference against plan bounds
 *
 * @param reference - Workout reference to validate
 * @param totalWeeks - Total weeks in the plan
 * @param daysPerWeek - Days per week (typically 5-7)
 * @returns Validation result with error message if invalid
 */
export function validateWorkoutReference(
  reference: WorkoutReference,
  totalWeeks: number,
  daysPerWeek: number = 7
): { valid: boolean; error?: string } {
  if (reference.week < 1 || reference.week > totalWeeks) {
    return {
      valid: false,
      error: `Week ${reference.week} is out of range (plan has ${totalWeeks} weeks)`
    }
  }

  if (reference.day < 1 || reference.day > daysPerWeek) {
    return {
      valid: false,
      error: `Day ${reference.day} is out of range (week has ${daysPerWeek} days)`
    }
  }

  return { valid: true }
}

/**
 * Get unique weeks referenced in a list of workout references
 *
 * @param references - Array of workout references
 * @returns Array of unique week numbers, sorted ascending
 *
 * @example
 * getUniqueWeeks([
 *   { week: 4, day: 2, ... },
 *   { week: 4, day: 5, ... },
 *   { week: 7, day: 1, ... }
 * ])
 * // Returns: [4, 7]
 */
export function getUniqueWeeks(references: WorkoutReference[]): number[] {
  const weeks = [...new Set(references.map(r => r.week))]
  return weeks.sort((a, b) => a - b)
}

/**
 * Group workout references by week
 *
 * @param references - Array of workout references
 * @returns Map of week number to workout references in that week
 *
 * @example
 * groupByWeek([
 *   { week: 4, day: 2, index: "W4:D2", ... },
 *   { week: 4, day: 5, index: "W4:D5", ... },
 *   { week: 7, day: 1, index: "W7:D1", ... }
 * ])
 * // Returns: {
 * //   4: [W4:D2, W4:D5],
 * //   7: [W7:D1]
 * // }
 */
export function groupByWeek(
  references: WorkoutReference[]
): Record<number, WorkoutReference[]> {
  const grouped: Record<number, WorkoutReference[]> = {}

  for (const ref of references) {
    if (!grouped[ref.week]) {
      grouped[ref.week] = []
    }
    grouped[ref.week].push(ref)
  }

  return grouped
}

/**
 * Format workout references for display
 *
 * @param references - Array of workout references
 * @returns Human-readable string
 *
 * @example
 * formatReferences([{ week: 4, day: 2, ... }, { week: 5, day: 3, ... }])
 * // Returns: "W4:D2, W5:D3"
 */
export function formatReferences(references: WorkoutReference[]): string {
  return references.map(r => r.index).join(', ')
}

/**
 * Check if text contains any workout references
 *
 * @param text - Text to check
 * @returns True if at least one workout reference found
 */
export function hasWorkoutReferences(text: string): boolean {
  return parseWorkoutReferences(text).length > 0
}
