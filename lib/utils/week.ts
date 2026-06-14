import { startOfWeek, endOfWeek } from 'date-fns'

export type WeekStartsOn = 0 | 1 | 2 | 3 | 4 | 5 | 6

/**
 * Resolve an athlete's preferred week-start day.
 *
 * Defaults to Sunday (0) when unset — matching the DB column default
 * (`athletes.week_starts_on default 0`), the calendar UI, and phase-progress.
 * This is the single source of truth so the AI context loaders and the UI
 * never disagree about which days fall in "this week".
 */
export function resolveWeekStartsOn(
    athlete: { week_starts_on?: number | null } | null | undefined
): WeekStartsOn {
    return ((athlete?.week_starts_on ?? 0) % 7) as WeekStartsOn
}

/** Start of the week containing `date`, honouring the athlete's preference. */
export function getWeekStart(date: Date, weekStartsOn: WeekStartsOn): Date {
    return startOfWeek(date, { weekStartsOn })
}

/** End of the week containing `date`, honouring the athlete's preference. */
export function getWeekEnd(date: Date, weekStartsOn: WeekStartsOn): Date {
    return endOfWeek(date, { weekStartsOn })
}
