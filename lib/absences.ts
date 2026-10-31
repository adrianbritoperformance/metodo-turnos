import type { requireProfile } from './supabase';

type SB = Awaited<ReturnType<typeof requireProfile>>['sb'];

export type AbsenceKind = 'vacaciones' | 'asuntos' | 'baja';
export type Absence = {
  id: string; user_id: string; kind: AbsenceKind; start_date: string; end_date: string; note: string | null;
};

export const ABSENCE: Record<AbsenceKind, { label: string; letter: string; bg: string; fg: string }> = {
  vacaciones: { label: 'Vacaciones', letter: 'V', bg: '#DCEBF7', fg: '#1E4E79' },
  asuntos: { label: 'Asuntos propios', letter: 'A', bg: '#EDE3F5', fg: '#5B2C83' },
  baja: { label: 'Baja', letter: 'B', bg: '#F3D9CB', fg: '#7A3A1F' },
};

/** Ausencias que tocan el rango de días [from, to] (YYYY-MM-DD, ambos incluidos). */
export async function loadAbsences(sb: SB, from: string, to: string, userId?: string) {
  let q = sb.from('absences').select('id, user_id, kind, start_date, end_date, note')
    .lte('start_date', to).gte('end_date', from).order('start_date');
  if (userId) q = q.eq('user_id', userId);
  const { data } = await q;
  return (data ?? []) as Absence[];
}

export const absentOn = (list: Absence[], day: string, userId?: string) =>
  list.filter((a) => a.start_date <= day && a.end_date >= day && (!userId || a.user_id === userId));
