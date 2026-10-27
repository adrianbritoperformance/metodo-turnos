import type { requireProfile } from './supabase';
import { addDays, daysBetween, madridMidnight, mondayOf, payPeriod, ymd } from './time';

type SB = Awaited<ReturnType<typeof requireProfile>>['sb'];

export type Bal = {
  shift_id: string; user_id: string; starts_at: string; ends_at: string; label: string | null;
  real_in: string | null; real_out: string | null; extra_minutes: number | null;
  has_pending_correction: boolean; planned_minutes: number;
};
export type Closing = {
  id: string; user_id: string; period_month: string; start_date: string; end_date: string;
  carried_in: number; worked_minutes: number; contract_minutes: number; balance_minutes: number;
  paid_minutes: number; carried_out: number; note: string | null; closed_at: string;
  worker_status: 'pending' | 'agree' | 'disagree'; worker_comment: string | null; worker_at: string | null;
};

export async function getPayStartDay(sb: SB) {
  const { data } = await sb.from('businesses').select('pay_start_day').single();
  return Number((data as { pay_start_day?: number } | null)?.pay_start_day ?? 26);
}

/**
 * Todo lo de un periodo de nómina para una persona: saldo (calculado en la base de datos),
 * lo que viene arrastrado, el cierre si existe y el desglose por semanas y días.
 */
export async function loadPeriod(sb: SB, userId: string, month: string, startDay: number, weeklyHours: number, openingMinutes: number) {
  const { start, end } = payPeriod(month, startDay);
  const weekFrom = mondayOf(start);
  const weekTo = addDays(mondayOf(end), 7);

  const [{ data: bal }, { data: shiftRows }, { data: closings }] = await Promise.all([
    sb.rpc('period_balance', { p_user: userId, p_month: `${month}-01` }),
    sb.from('shift_balance').select('*').eq('user_id', userId)
      .gte('starts_at', madridMidnight(weekFrom).toISOString()).lt('starts_at', madridMidnight(weekTo).toISOString())
      .order('starts_at'),
    sb.from('pay_closings').select('*').eq('user_id', userId).lte('period_month', `${month}-01`).order('period_month', { ascending: false }),
  ]);

  const b = (bal as { worked_minutes: number; contract_minutes: number; balance_minutes: number }[] | null)?.[0]
    ?? { worked_minutes: 0, contract_minutes: 0, balance_minutes: 0 };
  const all = (closings ?? []) as Closing[];
  const closing = all.find((c) => c.period_month.slice(0, 7) === month) ?? null;
  const prev = all.find((c) => c.period_month.slice(0, 7) < month);
  const carriedIn = closing ? closing.carried_in : prev ? prev.carried_out : openingMinutes;

  const shifts = (shiftRows ?? []) as Bal[];
  const now = Date.now();
  const weeks: {
    monday: string; worked: number; contract: number; open: boolean;
    days: { day: string; list: Bal[]; base: number; extra: number; future: boolean; missing: boolean; pending: boolean }[];
  }[] = [];
  for (let w = weekFrom; w < weekTo; w = addDays(w, 7)) {
    const inWeek = shifts.filter((s) => mondayOf(ymd(s.starts_at)) === w);
    if (inWeek.length === 0) continue;
    const lo = w < start ? start : w;
    const hi = addDays(w, 6) > end ? end : addDays(w, 6);
    const daysIn = daysBetween(lo, hi) + 1;
    const inPeriod = inWeek.filter((s) => { const d = ymd(s.starts_at); return d >= start && d <= end; });
    if (inPeriod.length === 0 && daysIn <= 0) continue;
    const byDay = new Map<string, Bal[]>();
    for (const s of inPeriod) byDay.set(ymd(s.starts_at), [...(byDay.get(ymd(s.starts_at)) ?? []), s]);
    const days = [...byDay.entries()].map(([day, list]) => ({
      day, list,
      base: list.reduce((a, s) => a + s.planned_minutes, 0),
      extra: list.reduce((a, s) => a + (s.extra_minutes ?? 0), 0),
      future: new Date(list[0].starts_at).getTime() > now,
      missing: list.some((s) => !s.real_out && new Date(s.ends_at).getTime() < now && !s.has_pending_correction),
      pending: list.some((s) => s.has_pending_correction),
    }));
    weeks.push({
      monday: w,
      worked: days.reduce((a, d) => a + d.base + d.extra, 0),
      contract: Math.round((weeklyHours * 60 * daysIn) / 7),
      open: madridMidnight(addDays(w, 7)).getTime() > now,
      days,
    });
  }

  return {
    start, end,
    worked: b.worked_minutes, contract: b.contract_minutes, balance: b.balance_minutes,
    carriedIn, closing, weeks,
    finished: madridMidnight(addDays(end, 1)).getTime() <= now,
    pastShifts: shifts.filter((s) => { const d = ymd(s.starts_at); return d >= start && d <= end && new Date(s.starts_at).getTime() < now; }),
  };
}
