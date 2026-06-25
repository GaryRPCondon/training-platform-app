/**
 * Helpers for composing the activity description we push to Strava/Garmin:
 * the athlete's own comment, preserved, with the AI summary appended below it.
 *
 * The push job reads the CURRENT live platform description and runs it through
 * stripSummaryBlock() before buildDescription(), so re-pushes never stack
 * duplicate summaries and a comment added after match time is never clobbered.
 */

export const SUMMARY_MARKER = 'trAIner Summary:'

/**
 * Drop a summary block we previously appended so re-pushes don't stack copies.
 * Everything from the marker onward (plus the delimiter before it) is removed,
 * leaving only the athlete's own comment.
 */
export function stripSummaryBlock(description: string | null): string | null {
  if (!description) return description
  const idx = description.indexOf(SUMMARY_MARKER)
  if (idx === -1) return description
  const before = description.slice(0, idx).trimEnd()
  return before.length > 0 ? before : null
}

/**
 * Compose the description to write back: athlete comment first (if any), a
 * single-line delimiter, then the AI summary block.
 */
export function buildDescription(
  ratingPrefix: string,
  aiSummary: string,
  existingDescription: string | null,
): string {
  const summaryBlock = `${SUMMARY_MARKER} ${ratingPrefix}${aiSummary}`
  if (!existingDescription) return summaryBlock
  // Preserve the athlete's own comment first, append the AI summary after it.
  return `${existingDescription}\n${summaryBlock}`
}
