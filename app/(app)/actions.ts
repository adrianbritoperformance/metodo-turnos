'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner, requireProfile } from '@/lib/supabase';
import { fmtTime } from '@/lib/time';

export type FicharResult =
  | { ok: true; kind: 'in' | 'out'; at: string; shiftEnd: string | null; extra: number | null }
  | { ok: false; error: string };

function codeFrom(raw: string) {
  try {
    const u = new URL(raw);
    return u.searchParams.get('c') ?? raw;
  } catch {
    return raw;
  }
}

export async function fichar(raw: string): Promise<FicharResult> {
  const { sb } = await requireProfile();
  const { data, error } = await sb.rpc('fichar', { p_code: codeFrom(raw.trim()) });
  if (error) {
    const msg = error.message.match(/(No has iniciado|Este QR|Ya has fichado)[^"]*/)?.[0];
    return { ok: false, error: msg ?? 'No se ha podido fichar. Inténtalo otra vez.' };
  }
  const row = (data as { kind: 'in' | 'out'; at: string; ends_at: string | null }[])[0];
  // Regla de salida: solo cuenta lo que pasa del fin de turno.
  const extra = row.kind === 'out' && row.ends_at
    ? Math.max(0, Math.floor((new Date(row.at).getTime() - new Date(row.ends_at).getTime()) / 60000))
    : null;
  revalidatePath('/', 'layout');
  return { ok: true, kind: row.kind, at: row.at, shiftEnd: row.ends_at, extra };
}

export async function requestCorrection(_: unknown, fd: FormData) {
  const { sb, profile } = await requireProfile();
  const shiftId = String(fd.get('shift_id') ?? '');
  const kind = String(fd.get('kind') ?? 'out');
  const time = String(fd.get('time') ?? '');
  const reason = String(fd.get('reason') ?? '').trim();
  const { data: shift } = await sb.from('shifts').select('starts_at, ends_at').eq('id', shiftId).single();
  if (!shift || !/^\d{2}:\d{2}$/.test(time)) return { error: 'Elige turno y hora.' };

  // La hora pedida se interpreta en el día del turno (hora de Madrid).
  const base = new Date(kind === 'in' ? shift.starts_at : shift.ends_at);
  const [h, m] = time.split(':').map(Number);
  const baseHm = fmtTime(base.toISOString()).split(':').map(Number);
  let diff = (h * 60 + m) - (baseHm[0] * 60 + baseHm[1]);
  if (diff < -12 * 60) diff += 24 * 60; // salida pasada la medianoche
  if (diff > 12 * 60) diff -= 24 * 60;
  const requested = new Date(base.getTime() + diff * 60000);

  const { error } = await sb.from('corrections').insert({
    business_id: profile.business_id, user_id: profile.id, shift_id: shiftId,
    kind, requested_at: requested.toISOString(), reason: reason || null,
  });
  if (error) return { error: 'No se ha podido enviar la corrección.' };
  revalidatePath('/horas');
  return { ok: 'Corrección enviada. La encargada la revisará.' };
}

/* ---------------- Encargada ---------------- */

export async function saveShift(_: unknown, fd: FormData) {
  const { sb } = await requireOwner();
  const id = String(fd.get('id') ?? '') || null;
  const { error } = await sb.rpc('save_shift', {
    p_id: id,
    p_user: String(fd.get('user_id') ?? ''),
    p_date: String(fd.get('date') ?? ''),
    p_start: String(fd.get('start') ?? ''),
    p_end: String(fd.get('end') ?? ''),
    p_label: String(fd.get('label') ?? ''),
    p_note: String(fd.get('note') ?? ''),
  });
  if (error) return { error: 'Revisa trabajador, día y horas.' };
  revalidatePath('/', 'layout');
  return { ok: id ? 'Turno actualizado.' : 'Turno creado.' };
}

export async function deleteShift(fd: FormData) {
  const { sb } = await requireOwner();
  await sb.from('shifts').delete().eq('id', String(fd.get('id')));
  revalidatePath('/', 'layout');
}

export async function reviewCorrection(fd: FormData) {
  const { sb } = await requireOwner();
  await sb.rpc('review_correction', { p_id: String(fd.get('id')), p_approve: fd.get('approve') === '1' });
  revalidatePath('/', 'layout');
}

export async function rotateQr() {
  const { sb } = await requireOwner();
  await sb.rpc('rotate_qr_secret');
  revalidatePath('/admin');
}

export async function setMember(fd: FormData) {
  const { sb, profile } = await requireOwner();
  const id = String(fd.get('id'));
  if (id === profile.id) return; // no quitarse a una misma el rol
  const patch: Record<string, unknown> = {};
  if (fd.has('role')) patch.role = fd.get('role') === 'owner' ? 'owner' : 'worker';
  if (fd.has('active')) patch.active = fd.get('active') === '1';
  await sb.from('profiles').update(patch).eq('id', id);
  revalidatePath('/admin');
}

/* ---------------- Reposición ---------------- */

export async function setStock(id: string, status: number) {
  const { sb, profile } = await requireProfile();
  await sb.from('stock_items')
    .update({ status: Math.min(2, Math.max(0, status)), updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq('id', id);
  revalidatePath('/reponer');
}

export async function addStock(_: unknown, fd: FormData) {
  const { sb, profile } = await requireOwner();
  const name = String(fd.get('name') ?? '').trim();
  if (!name) return { error: 'Pon el nombre del producto.' };
  const { error } = await sb.from('stock_items').insert({
    business_id: profile.business_id, name, place: String(fd.get('place') ?? '').trim() || null, sort: 999,
  });
  if (error) return { error: 'No se ha podido añadir.' };
  revalidatePath('/reponer');
  return { ok: 'Añadido.' };
}

export async function deleteStock(fd: FormData) {
  const { sb } = await requireOwner();
  await sb.from('stock_items').delete().eq('id', String(fd.get('id')));
  revalidatePath('/reponer');
}

/** Pedido hecho: todo lo marcado vuelve a "Hay". */
export async function markOrdered() {
  const { sb, profile } = await requireOwner();
  await sb.from('stock_items')
    .update({ status: 0, updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq('business_id', profile.business_id).gt('status', 0);
  revalidatePath('/reponer');
}
