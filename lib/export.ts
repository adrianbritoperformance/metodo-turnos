import { NextResponse } from 'next/server';
import type { requireProfile } from './supabase';
import { fmtTime, mondayOf, monthRange, ymd, addDays } from './time';
import { plannedOnly, type Contract, type WeekRow } from './balance';

type SB = Awaited<ReturnType<typeof requireProfile>>['sb'];

const hm = (min: number | null | undefined) => {
  if (min === null || min === undefined) return '';
  return `${min < 0 ? '-' : ''}${Math.floor(Math.abs(min) / 60)}:${String(Math.abs(min) % 60).padStart(2, '0')}`;
};
const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/**
 * Horas trabajadas de un mes natural en CSV (se abre en Excel). Uso interno del local.
 * `onlyUser`: solo esa persona.
 */
export async function hoursCsv(sb: SB, month: string, onlyUser?: string) {
  const { from, to } = monthRange(month);
  let q = sb.from('shift_balance').select('*').gte('starts_at', from).lt('starts_at', to).order('starts_at');
  if (onlyUser) q = q.eq('user_id', onlyUser);
  let w = sb.from('week_balance').select('*').order('week_start');
  if (onlyUser) w = w.eq('user_id', onlyUser);
  const [{ data: rows }, { data: people }, { data: weeks }] = await Promise.all([q, sb.rpc('get_contracts'), w]);
  const team = ((people ?? []) as Contract[]).filter((p) => p.role === 'worker' && (!onlyUser || p.user_id === onlyUser));
  const name = new Map(team.map((p) => [p.user_id, p.full_name]));
  const wk = ((weeks ?? []) as WeekRow[]).map(plannedOnly);
  const firstMonday = mondayOf(`${month}-01`);
  const lastDay = addDays(ymd(new Date(new Date(to).getTime() - 1)), 0);

  const lines: unknown[][] = [
    [`HORAS TRABAJADAS · ${month} · uso interno`],
    ['Persona', 'Fecha', 'Inicio', 'Fin', 'Entrada fichada', 'Salida fichada', 'Horas del horario', 'Minutos de más al fichar (aparte)', 'Corrección pendiente'],
    ...((rows ?? []) as { user_id: string; starts_at: string; ends_at: string; real_in: string | null; real_out: string | null; planned_minutes: number; extra_minutes: number | null; has_pending_correction: boolean }[])
      .filter((r) => name.has(r.user_id))
      .map((r) => [
        name.get(r.user_id), ymd(r.starts_at),
        fmtTime(r.starts_at), fmtTime(r.ends_at), r.real_in ? fmtTime(r.real_in) : '', r.real_out ? fmtTime(r.real_out) : '',
        hm(r.planned_minutes), r.extra_minutes ?? '', r.has_pending_correction ? 'Sí' : '',
      ]),
    [],
    ['SEMANAS (lunes a domingo)'],
    ['Persona', 'Semana (lunes)', 'Horas del horario', 'Horas de contrato', 'Diferencia', 'Saldo acumulado al acabar', 'Minutos de más al fichar (aparte)'],
    ...team.flatMap((p) => {
      let run = Number(p.opening_minutes ?? 0);
      return wk.filter((r) => r.user_id === p.user_id).flatMap((r) => {
        run += r.balance_minutes;
        if (r.week_start < firstMonday || r.week_start > lastDay) return [];
        return [[p.full_name, r.week_start, hm(r.planned_minutes), hm(r.contract_minutes), hm(r.balance_minutes), hm(run), r.extra_minutes || '']];
      });
    }),
  ];
  const csv = '﻿' + lines.map((l) => l.map(esc).join(';')).join('\r\n');
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="horas-${month}${onlyUser ? '-' + (name.get(onlyUser) ?? '').split(' ')[0].toLowerCase() : ''}.csv"`,
    },
  });
}
