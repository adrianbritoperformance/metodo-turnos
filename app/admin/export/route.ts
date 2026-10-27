import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { fmtTime, monthRange, ymd } from '@/lib/time';

/**
 * Registro de jornada del mes en CSV (se abre en Excel).
 * Una fila por turno: previsto, entrada y salida reales y minutos de exceso a la salida.
 */
export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));
  const { data: me } = await sb.from('profiles').select('role').eq('id', user.id).single();
  if (me?.role !== 'owner') return new NextResponse('Solo la encargada', { status: 403 });

  const m = req.nextUrl.searchParams.get('m') ?? ymd().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) return new NextResponse('Mes no válido', { status: 400 });
  const { from, to } = monthRange(m);

  const [{ data: rows }, { data: people }] = await Promise.all([
    sb.from('shift_balance').select('*').gte('starts_at', from).lt('starts_at', to).order('starts_at'),
    sb.from('profiles').select('id, full_name'),
  ]);
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const lines = [
    ['Trabajador', 'Fecha', 'Puesto', 'Inicio previsto', 'Fin previsto', 'Entrada real', 'Salida real', 'Minutos extra (salida)', 'Corrección pendiente'],
    ...(rows ?? []).map((r) => [
      name.get(r.user_id) ?? '', ymd(r.starts_at), r.label ?? '',
      fmtTime(r.starts_at), fmtTime(r.ends_at), fmtTime(r.real_in), fmtTime(r.real_out),
      r.extra_minutes ?? '', r.has_pending_correction ? 'Sí' : '',
    ]),
  ];
  // BOM + punto y coma para que Excel en español lo abra bien
  const csv = '﻿' + lines.map((l) => l.map(esc).join(';')).join('\r\n');
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="registro-jornada-${m}.csv"`,
    },
  });
}
