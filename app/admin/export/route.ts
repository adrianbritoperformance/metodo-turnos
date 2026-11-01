import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { hoursCsv } from '@/lib/export';
import { ymd } from '@/lib/time';

/** Horas trabajadas de todo el equipo en un mes (solo admins). Uso interno. */
export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));
  const { data: me } = await sb.from('profiles').select('role').eq('id', user.id).single();
  if (me?.role !== 'owner') return new NextResponse('Solo admins', { status: 403 });
  const m = req.nextUrl.searchParams.get('m') ?? ymd().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) return new NextResponse('Mes no válido', { status: 400 });
  return hoursCsv(sb, m);
}
