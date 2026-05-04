/**
 * Date helpers for plan creation.
 *
 * Single source of truth for the start-date → goal-date → weeks calculation.
 * The frontend (plan creator) and the backend (plan generation API) both call
 * the same helper so the URL parameter and the LLM prompt agree on the week
 * count. Diverging implementations were the bug fixed here on 2026-05-04.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Compute how many weeks of training fit between a start date and a goal date.
 *
 * Convention: counts the partial week containing the goal/race day. A 70-day
 * Mon→Sun span is 10 weeks; a 7-day Mon→Mon span is 2 weeks (one full training
 * week plus the partial week containing the race). Minimum return value is 1.
 *
 * Both arguments may be Date objects or YYYY-MM-DD strings (or anything
 * parseable by `new Date(...)`).
 */
export function computeWeeksAvailable(
  startDate: Date | string,
  goalDate: Date | string
): number {
  const start = startDate instanceof Date ? startDate : new Date(startDate)
  const goal = goalDate instanceof Date ? goalDate : new Date(goalDate)

  const days = Math.floor((goal.getTime() - start.getTime()) / MS_PER_DAY)
  if (days < 0) return 1
  return Math.floor(days / 7) + 1
}
