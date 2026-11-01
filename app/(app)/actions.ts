'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner, requireProfile, requireSuperadmin } from '@/lib/supabase';
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
  return { ok: 'Corrección enviada. Los responsables la revisarán.' };
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
    .update({ status: status > 0 ? 2 : 0, updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq('id', id);
  revalidatePath('/reponer');
}

export async function addStock(_: unknown, fd: FormData) {
  const { sb, profile } = await requireOwner();
  const name = String(fd.get('name') ?? '').trim();
  if (!name) return { error: 'Pon el nombre del producto.' };
  const category = String(fd.get('category') ?? '').trim() || 'Otros';
  const { error } = await sb.from('stock_items').insert({
    business_id: profile.business_id, name, category, place: String(fd.get('place') ?? '').trim() || null, sort: 999,
  });
  if (error) return { error: 'No se ha podido añadir.' };
  revalidatePath('/reponer');
  return { ok: 'Añadido.' };
}

export async function updateStockItem(fd: FormData) {
  const { sb } = await requireOwner();
  const name = String(fd.get('name') ?? '').trim();
  if (!name) return;
  await sb.from('stock_items').update({
    name,
    category: String(fd.get('category') ?? '').trim() || 'Otros',
    place: String(fd.get('place') ?? '').trim() || null,
  }).eq('id', String(fd.get('id')));
  revalidatePath('/reponer');
}

export async function deleteStock(fd: FormData) {
  const { sb } = await requireOwner();
  await sb.from('stock_items').delete().eq('id', String(fd.get('id')));
  revalidatePath('/reponer');
}

/** Repuesto: lo que faltaba vuelve a "Hay"; lo que quedaba poco se queda igual. */
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
    if (/10 minutos/.test(error.message)) return { error: 'Han pasado más de 10 minutos: pídeselo a los responsables.' };
    if (/motivo/.test(error.message)) return { error: 'Escribe el motivo.' };
    return { error: 'No se ha podido anular.' };
  }
  return { ok: 'Fichaje anulado.' };
}

export async function voidPunchForm(_: unknown, fd: FormData) {
  return voidPunch(String(fd.get('id')), String(fd.get('reason') ?? ''));
}

/* ---------------- Ausencias (solo informativas) ---------------- */

export async function addAbsence(_: unknown, fd: FormData) {
  const { sb, profile } = await requireOwner();
  const kind = String(fd.get('kind') ?? '');
  const start = String(fd.get('start') ?? '');
  const end = String(fd.get('end') ?? '') || start;
  if (!['vacaciones', 'asuntos', 'baja'].includes(kind)) return { error: 'Elige el tipo.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return { error: 'Revisa las fechas.' };
  const { error } = await sb.from('absences').insert({
    business_id: profile.business_id, user_id: String(fd.get('user_id')), kind,
    start_date: start, end_date: end, note: String(fd.get('note') ?? '').trim() || null, created_by: profile.id,
  });
  revalidatePath('/', 'layout');
  if (error) return { error: 'No se ha podido guardar.' };
  return { ok: 'Ausencia guardada.' };
}

export async function deleteAbsence(fd: FormData) {
  const { sb } = await requireOwner();
  await sb.from('absences').delete().eq('id', String(fd.get('id')));
  revalidatePath('/', 'layout');
}

/* ---------------- Avisos y tareas ---------------- */

export async function addNotice(_: unknown, fd: FormData) {
  const { sb, profile } = await requireOwner();
  const kind = fd.get('kind') === 'tarea' ? 'tarea' : 'mensaje';
  const body = String(fd.get('body') ?? '').trim();
  const day = String(fd.get('day') ?? '');
  const toAll = fd.get('to') === 'all';
  const ids = toAll ? [] : fd.getAll('user_ids').map(String).filter(Boolean);
  if (!body) return { error: 'Escribe el mensaje.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: 'Elige el día.' };
  if (!toAll && ids.length === 0) return { error: 'Elige al menos una persona o “Todo el equipo”.' };
  const { data: saved, error } = await sb.from('notices')
    .insert({ business_id: profile.business_id, day, kind, body, user_ids: ids, created_by: profile.id })
    .select('user_ids').single();
  revalidatePath('/', 'layout');
  if (error || !saved) return { error: 'No se ha podido guardar.' };
  let who = 'todo el equipo';
  if ((saved.user_ids as string[]).length > 0) {
    const { data: ppl } = await sb.from('profiles').select('full_name').in('id', saved.user_ids as string[]);
    who = (ppl ?? []).map((p) => p.full_name.split(' ')[0]).join(', ');
  }
  return { ok: `${kind === 'tarea' ? 'Tarea' : 'Mensaje'} guardado para: ${who}.` };
}

export async function deleteNotice(fd: FormData) {
  const { sb } = await requireOwner();
  await sb.from('notices').delete().eq('id', String(fd.get('id')));
  revalidatePath('/', 'layout');
}

export async function setNoticeDone(id: string, done: boolean) {
  const { sb } = await requireProfile();
  const { error } = await sb.rpc('set_notice_done', { p_id: id, p_done: done });
  revalidatePath('/', 'layout');
  return error ? { error: 'No se ha podido guardar.' } : {};
}

/* ---------------- Panel central (administrador de la plataforma) ---------------- */

export async function saSetAccount(_: unknown, fd: FormData) {
  const { sb } = await requireSuperadmin();
  const { error } = await sb.rpc('sa_set_account', {
    p_user: String(fd.get('user_id')),
    p_role: fd.get('role') === 'owner' ? 'owner' : 'worker',
    p_job_title: String(fd.get('job_title') ?? ''),
    p_active: fd.get('active') === '1',
  });
  revalidatePath('/', 'layout');
  return error ? { error: 'No se ha podido guardar.' } : { ok: 'Guardado.' };
}

export async function saCreateBusiness(_: unknown, fd: FormData) {
  const { sb } = await requireSuperadmin();
  const { error } = await sb.rpc('sa_create_business', {
    p_name: String(fd.get('name') ?? ''), p_join_code: String(fd.get('join_code') ?? ''),
  });
  revalidatePath('/central');
  if (error) return { error: /existe/.test(error.message) ? 'Ese código ya lo usa otro local.' : 'Rellena nombre y código.' };
  return { ok: 'Local creado. La primera cuenta que se registre con ese código será su admin.' };
}

export async function saSetPassword(_: unknown, fd: FormData) {
  const { sb } = await requireSuperadmin();
  const pw = String(fd.get('password') ?? '');
  if (pw.length < 6) return { error: 'Mínimo 6 caracteres.' };
  const { error } = await sb.rpc('sa_set_password', { p_user: String(fd.get('user_id')), p_password: pw });
  return error ? { error: 'No se ha podido cambiar.' } : { ok: 'Contraseña temporal puesta. Pásasela y que la cambie en Mi perfil.' };
}

/* ---------------- Plantilla semanal por persona ---------------- */

type Slot = { date: string; template: string; on: boolean; start: string; end: string; label: string };

export async function saveWeekPlan(_: unknown, fd: FormData) {
  const { sb } = await requireOwner();
  const userId = String(fd.get('user_id') ?? '');
  let slots: Slot[] = [];
  try { slots = JSON.parse(String(fd.get('slots') ?? '[]')); } catch { return { error: 'Datos no válidos.' }; }
  // Primero se quitan, luego se cambian/ponen: así no chocan mañana y tarde al mover horas.
  slots.sort((a, b) => Number(a.on) - Number(b.on));
  const errors: string[] = [];
  let changed = 0;
  for (const s of slots) {
    if (s.on && (!/^\d{2}:\d{2}$/.test(s.start) || !/^\d{2}:\d{2}$/.test(s.end))) { errors.push(`${s.label}: revisa las horas`); continue; }
    const { data, error } = await sb.rpc('set_slot', {
      p_user: userId, p_date: s.date, p_template: s.template, p_on: s.on,
      p_start: s.on ? s.start : null, p_end: s.on ? s.end : null,
    });
    if (error) {
      errors.push(`${s.label}: ${/solapa/.test(error.message) ? 'se pisa con otro turno'
        : /fichado/.test(error.message) ? 'ya está fichado y no se puede cambiar'
        : /no existe ese día/.test(error.message) ? 'no hay ese turno ese día' : 'no se ha podido guardar'}`);
    } else if (data !== 'sin cambios') changed++;
  }
  revalidatePath('/', 'layout');
  if (errors.length) return { error: `Guardado a medias (${changed} cambios). No se pudo: ${errors.join(' · ')}` };
  return { ok: changed ? `Semana guardada (${changed} ${changed === 1 ? 'cambio' : 'cambios'}).` : 'No había nada que cambiar.' };
}

/** Guarda el horario habitual completo de una persona (sustituye al anterior). */
export async function saveUsual(_: unknown, fd: FormData) {
  const { sb, profile } = await requireOwner();
  const userId = String(fd.get('user_id') ?? '');
  let slots: { weekday: number; template: string; on: boolean; start: string; end: string }[] = [];
  try { slots = JSON.parse(String(fd.get('slots') ?? '[]')); } catch { return { error: 'Datos no válidos.' }; }
  const rows = slots.filter((s) => s.on).map((s) => ({
    business_id: profile.business_id, user_id: userId, weekday: s.weekday, template_id: s.template,
    start_time: s.start, end_time: s.end,
  }));
  if (rows.some((r) => !/^\d{2}:\d{2}$/.test(r.start_time) || !/^\d{2}:\d{2}$/.test(r.end_time))) return { error: 'Revisa las horas.' };
  const del = await sb.from('usual_slots').delete().eq('user_id', userId);
  if (del.error) return { error: 'No se ha podido guardar.' };
  if (rows.length) {
    const ins = await sb.from('usual_slots').insert(rows);
    if (ins.error) return { error: 'No se ha podido guardar.' };
  }
  revalidatePath('/plantilla');
  return { ok: 'Horario habitual guardado.' };
}

/* ---------------- Horario por franjas ---------------- */

/** Pone y quita personas de una franja de un día (solo lo que cambia). */
export async function setBlockPeople(date: string, blockId: string, before: string[], after: string[]) {
  const { sb } = await requireOwner();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Día no válido.' };
  const add = after.filter((x) => !before.includes(x));
  const remove = before.filter((x) => !after.includes(x));
  const { data: ppl } = await sb.from('profiles').select('id, full_name').in('id', [...add, ...remove]);
  const name = new Map(((ppl ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name.split(' ')[0]]));
  const failed: string[] = [];
  for (const [ids, on] of [[remove, false], [add, true]] as const) {
    for (const id of ids) {
      const { error } = await sb.rpc('toggle_block', { p_user: id, p_date: date, p_block: blockId, p_on: on });
      if (error) {
        const why = /fichado/.test(error.message) ? 'ya fichó ese turno y ha terminado'
          : /solapa/.test(error.message) ? 'tiene otro turno que se cruza'
          : 'no se ha podido guardar';
        failed.push(`${name.get(id) ?? '—'}: ${why}`);
      }
    }
  }
  revalidatePath('/', 'layout');
  return failed.length ? { error: failed.join(' · ') } : { ok: 'Guardado.' };
}

/** Franjas del horario (Gestión). */
export async function saveBlock(_: unknown, fd: FormData) {
  const { sb, profile } = await requireOwner();
  const id = String(fd.get('id') ?? '');
  const st = String(fd.get('start') ?? '');
  const en = String(fd.get('end') ?? '');
  const weekdays = fd.getAll('wd').map(Number).filter((n) => n >= 1 && n <= 7);
  if (!/^\d{2}:\d{2}/.test(st) || !/^\d{2}:\d{2}/.test(en)) return { error: 'Pon la hora de inicio y de fin.' };
  if (en <= st) return { error: 'La hora de fin tiene que ser después de la de inicio.' };
  if (weekdays.length === 0) return { error: 'Marca al menos un día.' };
  const row = { start_time: st, end_time: en, weekdays };
  const { error } = id
    ? await sb.from('day_blocks').update(row).eq('id', id)
    : await sb.from('day_blocks').insert({ ...row, business_id: profile.business_id });
  revalidatePath('/', 'layout');
  if (error) return { error: 'No se ha podido guardar.' };
  return { ok: id ? 'Franja cambiada. Los turnos ya puestos no se tocan.' : 'Franja añadida.' };
}

export async function deleteBlock(fd: FormData) {
  const { sb } = await requireOwner();
  await sb.from('day_blocks').delete().eq('id', String(fd.get('id')));
  revalidatePath('/', 'layout');
}

/* ---------------- Mensajes de las trabajadoras ---------------- */

export async function sendMessage(_: unknown, fd: FormData) {
  const { sb, profile } = await requireProfile();
  const body = String(fd.get('body') ?? '').trim();
  const day = String(fd.get('day') ?? '');
  const ids = fd.getAll('user_ids').map(String).filter(Boolean);
  if (!body) return { error: 'Escribe el mensaje.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: 'Elige el día.' };
  if (ids.length === 0) return { error: 'Elige al menos una compañera.' };
  const { error } = await sb.from('notices')
    .insert({ business_id: profile.business_id, day, kind: 'mensaje', body, user_ids: ids, created_by: profile.id });
  revalidatePath('/', 'layout');
  if (error) return { error: 'No se ha podido enviar.' };
  return { ok: 'Mensaje enviado.' };
}

export async function deleteMyMessage(fd: FormData) {
  const { sb } = await requireProfile();
  await sb.from('notices').delete().eq('id', String(fd.get('id')));
  revalidatePath('/', 'layout');
}

/* ---------------- Tareas que se repiten ---------------- */

export async function saveTaskRule(_: unknown, fd: FormData) {
  const { sb, profile } = await requireOwner();
  const body = String(fd.get('body') ?? '').trim();
  const weekdays = fd.getAll('wd').map(Number).filter((n) => n >= 1 && n <= 7);
  const user_ids = fd.getAll('user_ids').map(String).filter(Boolean);
  const jobs = fd.getAll('jobs').map(String).filter(Boolean);
  const part = ['morning', 'afternoon'].includes(String(fd.get('part'))) ? String(fd.get('part')) : 'any';
  if (!body) return { error: 'Escribe la tarea.' };
  if (weekdays.length === 0) return { error: 'Marca qué días se repite.' };
  if (user_ids.length + jobs.length === 0) return { error: 'Elige a quién: un puesto o una persona.' };
  const { error } = await sb.from('task_rules')
    .insert({ business_id: profile.business_id, body, weekdays, user_ids, jobs, part, created_by: profile.id });
  revalidatePath('/', 'layout');
  if (error) return { error: 'No se ha podido guardar.' };
  return { ok: 'Tarea guardada. Saldrá sola los días marcados a quien trabaje.' };
}

export async function deleteTaskRule(fd: FormData) {
  const { sb } = await requireOwner();
  await sb.from('task_rules').delete().eq('id', String(fd.get('id')));
  revalidatePath('/', 'layout');
}

export async function setRuleDone(ruleId: string, day: string, done: boolean) {
  const { sb } = await requireProfile();
  const { error } = await sb.rpc('set_rule_done', { p_rule: ruleId, p_day: day, p_done: done });
  revalidatePath('/', 'layout');
  return error ? { error: 'No se ha podido guardar.' } : {};
}
