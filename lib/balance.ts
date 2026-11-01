import type { requireProfile } from './supabase';

type SB = Awaited<ReturnType<typeof requireProfile>>['sb'];

/** Una semana (lunes a domingo) de una persona, calculada por la vista week_balance. */
export type WeekRow = {
  user_id: string; week_start: string; shifts: number;
  planned_minutes: number; extra_minutes: number; worked_minutes: number;
  contract_minutes: number; balance_minutes: number; has_missing_out: boolean; closed: boolean;
};

export type Contract = {
  user_id: string; full_name: string; weekly_hours: number; role: string; active: boolean;
  opening_minutes?: number | null;
};

/**
 * Todas las semanas visibles (las propias, o las de todo el equipo si es admin).
 * El saldo sale SOLO del horario: horas puestas − contrato. Los minutos de más al
 * fichar la salida (extra_minutes) se enseñan aparte y no cuentan en el saldo.
 */
export function plannedOnly(r: WeekRow): WeekRow {
  return {
    ...r,
    week_start: String(r.week_start).slice(0, 10),
    worked_minutes: r.planned_minutes,
    balance_minutes: r.planned_minutes - r.contract_minutes,
  };
}

export async function loadWeekRows(sb: SB, userId?: string) {
  let q = sb.from('week_balance').select('*').order('week_start');
  if (userId) q = q.eq('user_id', userId);
  const { data } = await q;
  return ((data ?? []) as WeekRow[]).map(plannedOnly);
}

/**
 * Saldo acumulado de una persona antes de la semana que empieza en `monday`:
 * suma de (horas del horario − contrato) de cada semana anterior con turnos.
 * Positivo: se le deben horas. Negativo: debe horas.
 */
export function saldoBefore(rows: WeekRow[], userId: string, monday: string, opening = 0) {
  return rows.filter((r) => r.user_id === userId && r.week_start < monday).reduce((a, r) => a + r.balance_minutes, opening);
}

/** Texto corto del saldo para planificar: "le debemos 1 h 30" / "debe 2 h" / "al día". */
export function saldoText(min: number) {
  const a = Math.abs(Math.round(min));
  if (a < 1) return 'al día';
  const h = Math.floor(a / 60), m = a % 60;
  const t = h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
  return min > 0 ? `se le deben ${t}` : `debe ${t}`;
}
