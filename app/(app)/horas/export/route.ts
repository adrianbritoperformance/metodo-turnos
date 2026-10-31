import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { payrollCsv } from '@/lib/export';
import { getPayStartDay } from '@/lib/period';
import { payMonthOf, ymd } from '@/lib/time';

/** Cada trabajadora descarga su propio registro de jornada. */
export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));
  const m = req.nextUrl.searchParams.get('m') ?? payMonthOf(ymd(), await getPayStartDay(sb));
  if (!/^\d{4}-\d{2}$/.test(m)) return new NextResponse('Mes no válido', { status: 400 });
  // Un admin puede descargar el registro de cualquier trabajadora (?u=); el resto, solo el suyo.
  const u = req.nextUrl.searchParams.get('u');
  if (u && u !== user.id) {
    const { data: me } = await sb.from('profiles').select('role').eq('id', user.id).single();
    if (me?.role !== 'owner') return new NextResponse('Sin acceso', { status: 403 });
    return payrollCsv(sb, m, u);
  }
  return payrollCsv(sb, m, user.id);
}
