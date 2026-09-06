/**
 * When Cure Và opens — one source, read by every page.
 *
 * The date was written out in twenty-five places across nine files, and
 * three of them were not copy at all: the JobPosting `validThrough` (a
 * posting past it is dropped by Google outright), the LocalBusiness
 * `foundingDate`, and the countdown's target. Moving the opening by one
 * season meant finding all three by hand. It does not any more.
 */

/** The moment the doors open. */
export const OPENING = new Date("2027-03-15T09:00:00Z");

/** `YYYY-MM-DD` — for structured data, which wants a date and not a time. */
export const OPENING_ISO = OPENING.toISOString().slice(0, 10);

/** The season, for headings and eyebrows: "Spring 2027". */
export const OPENING_SEASON = "Spring 2027";

/** The day itself, for the one place that names it: "March 15, 2027". */
export const OPENING_DAY = "March 15, 2027";

/**
 * How close the opening has to be before a live countdown is worth showing.
 *
 * A counter reading "191 days" is not anticipation, it is a number — and it
 * ticks a second at a time for six months while nothing happens. Inside two
 * months it starts to mean something. Outside it, the page states the date
 * instead.
 */
export const COUNTDOWN_WITHIN_DAYS = 60;

/** Whole days from now until opening. Negative once it has passed. */
export function daysUntilOpening(now: Date = new Date()): number {
	return Math.ceil((OPENING.getTime() - now.getTime()) / 86_400_000);
}

/**
 * Decided on the SERVER, not in the browser: these pages are
 * `prerender: false`, so the choice is made per request and the right thing
 * is in the HTML before any script runs. A visitor with JavaScript off gets
 * the date rather than four empty boxes.
 */
export function showCountdown(now: Date = new Date()): boolean {
	const days = daysUntilOpening(now);
	return days >= 0 && days <= COUNTDOWN_WITHIN_DAYS;
}
