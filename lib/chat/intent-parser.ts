/**
 * Intent Parser for Plan Modifications
 *
 *
 * This module provides utility functions for:
 * - Extracting workout references (W#:D#) for UI highlighting
 * - Helper functions for week range calculations
 */

import { parseWorkoutReferences, getUniqueWeeks } from './workout-reference-parser'

/**
 * Extract workout references from user message
 *
 * @param userMessage - User's modification request
 * @returns Array of workout references (W#:D#) found in message
 *
 * @example
 * extractWorkoutReferences("Change W4:D2 to 12km and W4:D5 to rest")
 * // Returns: [
 * //   { week: 4, day: 2, index: "W4:D2", ... },
 * //   { week: 4, day: 5, index: "W4:D5", ... }
 * // ]
 */
export function extractWorkoutReferences(userMessage: string) {
  return parseWorkoutReferences(userMessage)
}

/**
 * Check if message contains specific workout references
 *
 * Useful for UI to determine if we should highlight referenced workouts
 *
 * @param userMessage - User's message
 * @returns True if message contains W#:D# style references
 */
export function hasSpecificWorkoutReferences(userMessage: string): boolean {
  return parseWorkoutReferences(userMessage).length > 0
}

/**
 * Get affected weeks from workout references
 *
 * @param userMessage - User's message
 * @returns Unique week numbers referenced, sorted ascending
 *
 * @example
 * getReferencedWeeks("Swap W3:D1 and W5:D2")
 * // Returns: [3, 5]
 */
export function getReferencedWeeks(userMessage: string): number[] {
  const refs = parseWorkoutReferences(userMessage)
  return getUniqueWeeks(refs)
}

/**
 * Format user message for LLM with highlighted workout references
 *
 * Optional: Used to make workout references more explicit in the prompt
 *
 * @param userMessage - Original user message
 * @returns Message with workout references highlighted (if any)
 */
export function formatMessageForLLM(userMessage: string): string {
  const refs = parseWorkoutReferences(userMessage)

  if (refs.length === 0) {
    return userMessage
  }

  // Add explicit note about workout references
  const refList = refs.map(r => r.index).join(', ')
  return `${userMessage}\n\n(Workout references detected: ${refList})`
}
