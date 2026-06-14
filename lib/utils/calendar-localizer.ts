import { dateFnsLocalizer } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { enUS } from 'date-fns/locale'
import type { WeekStartsOn } from './week'

/**
 * react-big-calendar localizer backed by date-fns (replaces moment.js).
 *
 * The athlete's week-start preference is carried on a cloned locale's
 * `options.weekStartsOn`; RBC derives the first day of the week from it, so
 * callers MUST pass `culture="en-US"` to the Calendar for it to take effect.
 */
export function createCalendarLocalizer(weekStartsOn: WeekStartsOn) {
    const locale = { ...enUS, options: { ...enUS.options, weekStartsOn } }
    return dateFnsLocalizer({
        format,
        parse,
        startOfWeek,
        getDay,
        locales: { 'en-US': locale },
    })
}
