export const KAMPALA_CENTER = [0.3301, 32.6006];

const timeFormatter = new Intl.DateTimeFormat('en-UG', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Africa/Kampala',
});

const dayFormatter = new Intl.DateTimeFormat('en-UG', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Africa/Kampala',
});

export function formatUgx(amount) {
  return `UGX ${Number(amount || 0).toLocaleString('en-US')}`;
}

export function formatShortUgx(amount) {
  const value = Number(amount || 0);
  if (value >= 1000) {
    const k = value / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return String(value);
}

export function formatTime(iso) {
  return timeFormatter.format(new Date(iso)).replace(/\s/g, '').toLowerCase();
}

export function formatWindow(startIso, endIso) {
  return `${formatTime(startIso)} – ${formatTime(endIso)}`;
}

export function formatDay(iso) {
  const date = new Date(iso);
  const todayKey = dayFormatter.format(new Date());
  const key = dayFormatter.format(date);
  return key === todayKey ? 'Today' : key;
}

export function discountPercent(original, discount) {
  if (!original || original <= discount) return 0;
  return Math.round((1 - discount / original) * 100);
}

export function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function pickupState(startIso, endIso, now = Date.now()) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (now < start) return { phase: 'upcoming', label: `Opens in ${formatDuration(start - now)}` };
  if (now <= end) return { phase: 'open', label: `Open now · closes in ${formatDuration(end - now)}` };
  return { phase: 'closed', label: 'Pickup window has closed' };
}

/** Great-circle distance in km. */
export function distanceKm(a, b) {
  if (!a || !b) return null;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export function formatDistance(km) {
  if (km === null || km === undefined) return null;
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export function directionsUrl(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}
