import { NextResponse } from 'next/server';
import type { requireProfile } from './supabase';
import { getPayStartDay, type Closing } from './period';
import { fmtTime, madridMidnight, addDays, payPeriod, ymd } from './time';

type SB = Awaited<ReturnType<typeof requireProfile>>['sb'];

const hm = (min: number | null | undefined) => {
  if (min === null || min === undefined) return '';
  return `${min < 0 ? '-' : ''}${Math.floor(Math.abs(min) / 60)}:${String(Math.abs(min) % 60).padStart(2, '0')}`;
};
const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/**
 * Registro de jornada de un periodo de nómina en CSV (se abre en Excel).
 * `onlyUser`: si se pasa, solo esa persona (la trabajadora descargando lo suyo).
 */
export async function payrollCsv(sb: SB, month: string, onlyUser?: string) {
  const startDay = await getPayStartDay(sb);
  const { start, end } = payPeriod(month, startDay);
  const from = madridMidnight(start).toISOString();
  const to = madridMidnight(addDays(end, 1)).toISOString();

  let q = sb.from('shift_balance').select('*').gte('starts_at', from).lt('starts_at', to).order('starts_at');
  if (onlyUser) q = q.eq('user_id', onlyUser);
  const [{ data: rows }, { data: people }, { data: closings }] = await Promise.all([
    q,
    sb.rpc('get_contracts'),
    sb.from('pay_closings').select('*').lte('period_month', `${month}-01`).order('period_month', { ascending: false }),
  ]);
  const team = ((people ?? []) as { user_id: string; full_name: string; weekly_hours: number; opening_minutes: number }[])
    .filter((p) => !onlyUser || p.user_id === onlyUser);
  const name = new Map(team.map((p) => [p.user_id, p.full_name]));
  const all = (closings ?? []) as Closing[];
  const balances = await Promise.all(team.map((p) => sb.rpc('period_balance', { p_user: p.user_id, p_month: `${month}-01` })));

  const lines: unknown[][] = [
    [`REGISTRO DE JORNADA · Nómina ${month} (${start} a ${end})`],
    ['Trabajador', 'Fecha', 'Puesto', 'Inicio previsto', 'Fin previsto', 'Entrada real', 'Salida real', 'Horas base', 'Minutos extra (salida)', 'Total día', 'Corrección pendiente'],
    ...((rows ?? []) as { user_id: string; starts_at: string; ends_at: string; label: string | null; real_in: string | null; real_out: string | null; planned_minutes: number; extra_minutes: number | null; has_pending_correction: boolean }[])
      .filter((r) => name.has(r.user_id))
      .map((r) => [
        name.get(r.user_id), ymd(r.starts_at), r.label ?? '',
        fmtTime(r.starts_at), fmtTime(r.ends_at), r.real_in ? fmtTime(r.real_in) : '', r.real_out ? fmtTime(r.real_out) : '',
        hm(r.planned_minutes), r.extra_minutes ?? '', hm(r.planned_minutes + (r.extra_minutes ?? 0)), r.has_pending_correction ? 'Sí' : '',
      ]),
    [],
    ['RESUMEN DEL PERIODO'],
    ['Trabajador', 'Contrato h/sem', 'Horas hechas', 'Horas contrato', 'Saldo del periodo', 'Venía de antes', 'Pagadas en nómina', 'Queda para compensar', 'Conformidad', 'Comentario'],
    ...team.map((p, i) => {
      const b = (balances[i].data as { worked_minutes: number; contract_minutes: number; balance_minutes: number }[] | null)?.[0];
      const mine = all.filter((c) => c.user_id === p.user_id);
      const c = mine.find((x) => x.period_month.slice(0, 7) === month);
      const prev = mine.find((x) => x.period_month.slice(0, 7) < month);
      const carried = c ? c.carried_in : prev ? prev.carried_out : p.opening_minutes;
      const status = !c ? 'Sin cerrar' : c.worker_status === 'agree' ? 'Conforme' : c.worker_status === 'disagree' ? 'No conforme' : 'Pendiente';
      return [
        p.full_name, Number(p.weekly_hours), hm(b?.worked_minutes), hm(b?.contract_minutes), hm(c ? c.balance_minutes : b?.balance_minutes),
        hm(carried), c ? hm(c.paid_minutes) : '', hm(c ? c.carried_out : carried + (b?.balance_minutes ?? 0)), status, c?.worker_comment ?? '',
      ];
    }),
  ];
  const csv = '﻿' + lines.map((l) => l.map(esc).join(';')).join('\r\n');
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="registro-jornada-${month}${onlyUser ? '-' + (name.get(onlyUser) ?? '').split(' ')[0].toLowerCase() : ''}.csv"`,
    },
  });
}
