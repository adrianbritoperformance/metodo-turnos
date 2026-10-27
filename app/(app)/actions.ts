'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner, requireProfile } from '@/lib/supabase';
import { fmtTime, parseHours } from '@/lib/time';

export type FicharResult =
  | { ok: true; id: string; kind: 'in' | 'out'; at: string; shiftEnd: string | null; extra: number | null }
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
  const row = (data as { id: string; kind: 'in' | 'out'; at: string; ends_at: string | null }[])[0];
  // Regla de salida: solo cuenta lo que pasa del fin de turno.
  const extra = row.kind === 'out' && row.ends_at
    ? Math.max(0, Math.floor((new Date(row.at).getTime() - new Date(row.ends_at).getTime()) / 60000))
    : null;
  revalidatePath('/', 'layout');
  return { ok: true, id: row.id, kind: row.kind, at: row.at, shiftEnd: row.ends_at, extra };
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
  if (error) return { error: /solapa/.test(error.message) ? 'Esa persona ya tiene otro turno que se pisa con este horario.' : /fichado/.test(error.message) ? 'Ese turno ya está fichado y terminado: solo se puede cambiar el puesto o la tarea. Si hay un error de horas, pide una corrección de fichaje.' : 'Revisa trabajador, día y horas.' };
  revalidatePath('/', 'layout');
  return { ok: id ? 'Turno actualizado.' : 'Turno creado.' };
}

export async function deleteShift(fd: FormData) {
  const { sb } = await requireOwner();
  await sb.from('shifts').delete().eq('id', String(fd.get('id'))); // si está fichado y terminado, la base de datos lo impide
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

export async function setContract(fd: FormData) {
  const { sb } = await requireOwner();
  const h = Number(String(fd.get('weekly_hours') ?? '').replace(',', '.'));
  if (!Number.isFinite(h) || h < 0 || h > 60) return;
  await sb.from('profiles').update({ weekly_hours: Math.round(h * 2) / 2 }).eq('id', String(fd.get('id')));
  revalidatePath('/', 'layout');
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

/* ---------------- Turnos tipo (Mañana / Tarde) ---------------- */

export async function toggleTemplate(userId: string, date: string, templateId: string, on: boolean) {
  const { sb } = await requireOwner();
  const { error } = await sb.rpc('toggle_template_shift', { p_user: userId, p_date: date, p_template: templateId, p_on: on });
  revalidatePath('/turnos');
  if (error) return { error: /fichajes/.test(error.message) ? 'Ese turno ya tiene fichajes: no se puede quitar.' : /solapa/.test(error.message) ? 'Ya tiene otro turno a esa hora.' : 'No se ha podido guardar.' };
  return {};
}

export async function copyWeek(fd: FormData) {
  const { sb } = await requireOwner();
  await sb.rpc('copy_week', { p_from: String(fd.get('from')), p_to: String(fd.get('to')) });
  revalidatePath('/', 'layout');
}

export async function saveTemplates(fd: FormData) {
  const { sb } = await requireOwner();
  const ids = fd.getAll('id').map(String);
  for (const id of ids) {
    const st = String(fd.get(`start_${id}`) ?? '');
    const en = String(fd.get(`end_${id}`) ?? '');
    if (/^\d{2}:\d{2}/.test(st) && /^\d{2}:\d{2}/.test(en)) {
      await sb.from('shift_templates').update({ start_time: st, end_time: en }).eq('id', id);
    }
  }
  revalidatePath('/', 'layout');
}

export async function clearWeek(_: unknown, fd: FormData) {
  const { sb } = await requireOwner();
  const { data, error } = await sb.rpc('clear_week', { p_monday: String(fd.get('monday')) });
  revalidatePath('/', 'layout');
  if (error) return { error: 'No se ha podido borrar la semana.' };
  const r = (data as { deleted: number; kept: number }[])[0];
  return {
    ok: `Borrados ${r.deleted} turnos.` + (r.kept ? ` ${r.kept} se han conservado porque ya tienen fichajes.` : ''),
  };
}

/* ---------------- Perfil ---------------- */

export async function setMyColor(fd: FormData) {
  const { sb } = await requireProfile();
  const c = String(fd.get('color') ?? '');
  await sb.rpc('set_my_color', { p_color: /^#[0-9A-Fa-f]{6}$/.test(c) ? c : null });
  revalidatePath('/', 'layout');
}

/* ---------------- Nómina y control ---------------- */

export async function closePeriod(_: unknown, fd: FormData) {
  const { sb } = await requireOwner();
  const paid = parseHours(String(fd.get('paid') ?? '0'));
  if (!Number.isFinite(paid) || paid < 0) return { error: 'Escribe las horas pagadas, por ejemplo 5 o 5:30.' };
  const { error } = await sb.rpc('close_period', {
    p_user: String(fd.get('user_id')), p_month: `${String(fd.get('month'))}-01`,
    p_paid: paid, p_note: String(fd.get('note') ?? ''),
  });
  revalidatePath('/', 'layout');
  if (error) return { error: 'No se ha podido cerrar.' };
  return { ok: 'Nómina cerrada. La trabajadora ya lo ve y puede dar su conformidad.' };
}

export async function respondClosing(_: unknown, fd: FormData) {
  const { sb } = await requireProfile();
  const { error } = await sb.rpc('respond_closing', {
    p_id: String(fd.get('id')), p_agree: fd.get('agree') === '1', p_comment: String(fd.get('comment') ?? ''),
  });
  revalidatePath('/', 'layout');
  if (error) return { error: 'No se ha podido guardar.' };
  return { ok: 'Respuesta guardada.' };
}

export async function setOpening(_: unknown, fd: FormData) {
  const { sb } = await requireOwner();
  const min = parseHours(String(fd.get('opening') ?? '0'));
  if (!Number.isFinite(min)) return { error: 'Escribe las horas, por ejemplo -7 o 3:30.' };
  const { error } = await sb.rpc('set_opening', { p_user: String(fd.get('user_id')), p_minutes: min, p_note: String(fd.get('note') ?? '') });
  revalidatePath('/', 'layout');
  if (error) return { error: 'No se ha podido guardar.' };
  return { ok: 'Saldo inicial guardado.' };
}

export async function setPayStartDay(fd: FormData) {
  const { sb } = await requireOwner();
  const d = Number(fd.get('day'));
  if (!Number.isInteger(d) || d < 1 || d > 28) return;
  await sb.rpc('set_pay_start_day', { p_day: d });
  revalidatePath('/', 'layout');
}

export async function shiftFromPunches(fd: FormData) {
  const { sb } = await requireOwner();
  await sb.rpc('shift_from_punches', { p_user: String(fd.get('user_id')), p_date: String(fd.get('date')) });
  revalidatePath('/', 'layout');
}

/** Anular un fichaje: la trabajadora en los 10 minutos siguientes, la encargada siempre (con motivo). */
export async function voidPunch(id: string, reason: string) {
  const { sb } = await requireProfile();
  const { error } = await sb.rpc('void_punch', { p_id: id, p_reason: reason });
  revalidatePath('/', 'layout');
  if (error) {
    if (/10 minutos/.test(error.message)) return { error: 'Han pasado más de 10 minutos: pídeselo a la encargada.' };
    if (/motivo/.test(error.message)) return { error: 'Escribe el motivo.' };
    return { error: 'No se ha podido anular.' };
  }
  return { ok: 'Fichaje anulado.' };
}

export async function voidPunchForm(_: unknown, fd: FormData) {
  return voidPunch(String(fd.get('id')), String(fd.get('reason') ?? ''));
}
