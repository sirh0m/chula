// Kampala observes East Africa Time (UTC+3) with no daylight saving.
export const KAMPALA_OFFSET_MINUTES = 180;
const OFFSET_MS = KAMPALA_OFFSET_MINUTES * 60 * 1000;

export function kampalaParts(date = new Date()) {
  const shifted = new Date(date.getTime() + OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** Build a Date for HH:MM today in Kampala. */
export function kampalaTimeToday(hour, minute = 0, now = new Date()) {
  const { year, month, day } = kampalaParts(now);
  return new Date(Date.UTC(year, month, day, hour, minute) - OFFSET_MS);
}

export function endOfKampalaDay(now = new Date()) {
  return kampalaTimeToday(23, 59, now);
}

export function startOfKampalaDay(now = new Date()) {
  return kampalaTimeToday(0, 0, now);
}

/** Parse "18:00", "6pm", "6:30 pm", "18h" into { hour, minute }. */
export function parseClockTime(raw) {
  if (raw === null || raw === undefined) return null;
  const match = String(raw).trim().toLowerCase().match(/^(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm)?h?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  }
  if (hour > 23) return null;
  return { hour, minute };
}

/**
 * Default pickup window for a listing made via WhatsApp:
 * 18:00–20:00 if it's before 17:00 in Kampala, otherwise starting 30 minutes from now for two hours.
 */
export function defaultPickupWindow(now = new Date()) {
  const { hour } = kampalaParts(now);
  const endOfDay = endOfKampalaDay(now);
  if (hour < 17) {
    return { start: kampalaTimeToday(18, 0, now), end: kampalaTimeToday(20, 0, now) };
  }
  const start = new Date(Math.ceil((now.getTime() + 30 * 60 * 1000) / (15 * 60 * 1000)) * 15 * 60 * 1000);
  const end = new Date(Math.min(start.getTime() + 2 * 60 * 60 * 1000, endOfDay.getTime()));
  if (end <= start) return { start: now, end: endOfDay };
  return { start, end };
}

export function formatKampalaTime(date) {
  const { hour, minute } = kampalaParts(new Date(date));
  const suffix = hour >= 12 ? 'pm' : 'am';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${h12}${suffix}` : `${h12}:${String(minute).padStart(2, '0')}${suffix}`;
}

export function formatKampalaWindow(start, end) {
  return `${formatKampalaTime(start)}–${formatKampalaTime(end)}`;
}
