import type { requireProfile } from './supabase';

type SB = Awaited<ReturnType<typeof requireProfile>>['sb'];

export type Notice = {
  id: string; day: string; kind: 'mensaje' | 'tarea'; body: string; user_ids: string[];
  created_by: string | null; created_at: string; done_by: string | null; done_at: string | null;
};

/** Avisos de un día (la base de datos ya filtra: cada uno ve los suyos y los de todo el equipo). */
export async function loadNotices(sb: SB, day: string) {
  const { data } = await sb.from('notices').select('*').eq('day', day).order('kind', { ascending: false }).order('created_at');
  return (data ?? []) as Notice[];
}
