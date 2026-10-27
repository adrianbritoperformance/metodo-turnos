import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { payrollCsv } from '@/lib/export';
import { getPayStartDay } from '@/lib/period';
import { payMonthOf, ymd } from '@/lib/time';

/** Registro de jornada de todo el equipo (solo encargada). */
export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));
  const { data: me } = await sb.from('profiles').select('role').eq('id', user.id).single();
  if (me?.role !== 'owner') return new NextResponse('Solo la encargada', { status: 403 });
  const m = req.nextUrl.searchParams.get('m') ?? payMonthOf(ymd(), await getPayStartDay(sb));
  if (!/^\d{4}-\d{2}$/.test(m)) return new NextResponse('Mes no válido', { status: 400 });
  return payrollCsv(sb, m);
}
