export const TZ = 'Europe/Madrid';

const hm = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, weekday: 'short', day: 'numeric' });
const longDayFmt = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

export const fmtTime = (iso?: string | null) => (iso ? hm.format(new Date(iso)) : '—');
export const fmtDay = (iso: string) => cap(dayFmt.format(new Date(iso)).replace('.', ''));
export const fmtLongDay = (iso: string | Date) => cap(longDayFmt.format(new Date(iso)));
/** "YYYY-MM-DD" en hora de Madrid */
export const ymd = (d: Date | string = new Date()) => ymdFmt.format(new Date(d));

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

/** Desfase de Madrid en minutos para un instante (60 en invierno, 120 en verano). */
function offsetMinutes(at: Date) {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+01:00';
  const m = s.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m) return 0;
  const v = parseInt(m[2]) * 60 + parseInt(m[3] ?? '0');
  return m[1] === '-' ? -v : v;
}

/** Instante UTC de las 00:00 de Madrid de un día "YYYY-MM-DD". */
export function madridMidnight(day: string) {
  const [y, mo, d] = day.split('-').map(Number);
  const utc = Date.UTC(y, mo - 1, d);
  // Dos pasadas para acertar también los días de cambio de hora.
  const first = utc - offsetMinutes(new Date(utc)) * 60000;
  return new Date(utc - offsetMinutes(new Date(first)) * 60000);
}

export function addDays(day: string, n: number) {
  const [y, mo, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Rango [inicio, fin) de un día de Madrid, en ISO UTC. */
export function dayRange(day: string) {
  return { from: madridMidnight(day).toISOString(), to: madridMidnight(addDays(day, 1)).toISOString() };
}

/** Rango [inicio, fin) de un mes "YYYY-MM". */
export function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { from: madridMidnight(`${month}-01`).toISOString(), to: madridMidnight(`${next}-01`).toISOString() };
}

export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
}

export function monthName(month: string) {
  const [y, m] = month.split('-').map(Number);
  const s = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 15)));
  return cap(s);
}

/** Lunes de la semana que contiene `day`. */
export function mondayOf(day: string) {
  const [y, mo, d] = day.split('-').map(Number);
  const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0 domingo
  return addDays(day, wd === 0 ? -6 : 1 - wd);
}

export function fmtMinutes(min: number) {
  const sign = min < 0 ? '−' : '+';
  const a = Math.abs(min);
  const h = Math.floor(a / 60);
  const m = a % 60;
  if (h === 0) return `${sign}${m} min`;
  return m === 0 ? `${sign}${h} h` : `${sign}${h} h ${m} min`;
}

/** "32 h 10" sin signo */
export function fmtHours(min: number) {
  const a = Math.round(Math.abs(min));
  const h = Math.floor(a / 60);
  const m = a % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

/** "20–26 oct" para una semana que empieza el lunes `monday` (YYYY-MM-DD) */
export function fmtWeek(monday: string) {
  const end = addDays(monday, 6);
  const f = (d: string, withMonth: boolean) => {
    const [y, m, dd] = d.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, dd));
    return new Intl.DateTimeFormat('es-ES', { day: 'numeric', ...(withMonth ? { month: 'short' } : {}), timeZone: 'UTC' }).format(t).replace('.', '');
  };
  return `${f(monday, monday.slice(5, 7) !== end.slice(5, 7))}–${f(end, true)}`;
}

/* ---------------- Periodo de nómina ---------------- */

/** Periodo de la nómina del mes `month` ("YYYY-MM"): con corte 26 → del 26 del mes anterior al 25. */
export function payPeriod(month: string, startDay: number) {
  if (startDay <= 1) {
    const end = addDays(`${shiftMonth(month, 1)}-01`, -1);
    return { start: `${month}-01`, end };
  }
  const prev = shiftMonth(month, -1);
  return { start: `${prev}-${String(startDay).padStart(2, '0')}`, end: `${month}-${String(startDay - 1).padStart(2, '0')}` };
}

/** Mes de nómina al que pertenece un día. */
export function payMonthOf(day: string, startDay: number) {
  if (startDay <= 1) return day.slice(0, 7);
  return Number(day.slice(8)) >= startDay ? shiftMonth(day.slice(0, 7), 1) : day.slice(0, 7);
}

/** "26 oct – 25 nov" */
export function fmtRange(start: string, end: string) {
  const f = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number);
    return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, dd))).replace('.', '');
  };
  return `${f(start)} – ${f(end)}`;
}

/** Nombre del mes de nómina: "Noviembre" */
export function monthOnly(month: string) {
  const [y, m] = month.split('-').map(Number);
  const s = new Intl.DateTimeFormat('es-ES', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 15)));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Días entre dos fechas "YYYY-MM-DD" (b − a). */
export function daysBetween(a: string, b: string) {
  const t = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
  return Math.round((t(b) - t(a)) / 86400000);
}

/** Lee "5", "5,5", "5:30" o "5 h 30" como minutos. */
export function parseHours(v: string) {
  const s = v.trim().replace(/\s*h\s*/i, ':').replace(',', '.');
  if (!s) return 0;
  const neg = s.startsWith('-') || s.startsWith('−');
  const t = s.replace(/^[-−]/, '');
  let min: number;
  if (t.includes(':')) {
    const [h, m] = t.split(':');
    min = Number(h || 0) * 60 + Number(m || 0);
  } else min = Math.round(Number(t) * 60);
  if (!Number.isFinite(min)) return NaN;
  return neg ? -min : min;
}
