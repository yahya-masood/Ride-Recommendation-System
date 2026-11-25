// dateUtils.js - tiny time helpers shared by the logic modules.
// All stored dates are ISO strings (for example "2026-11-23T08:30:00.000Z").
// Every function that depends on "now" takes it as a parameter (milliseconds), so tests can fix the time.

// Converts a Date, an ISO string or a number of milliseconds into milliseconds.
// Returns NaN when the value is not a valid date.
export function toMs(value) {
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && value.trim() !== "") return Date.parse(value);
  return NaN;
}

export function isValidDate(value) {
  return Number.isFinite(toMs(value));
}

export function toIso(ms) {
  return new Date(ms).toISOString();
}

export const MINUTE_MS = 60 * 1000;

// Date/time inputs on the screens only have minute precision, so "now" typed by the user is up to one
// minute behind the real clock. A start or pickup time is therefore accepted if it is at most this
// much in the past (ASSUMPTION; SRS only says the start must not be in the past).
export const INPUT_GRACE_MS = MINUTE_MS;
