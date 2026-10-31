'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';

function safeNext(v: FormDataEntryValue | null) {
  const s = typeof v === 'string' ? v : '';
  return s.startsWith('/') && !s.startsWith('//') ? s : '/';
}

export async function login(_: unknown, fd: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({
    email: String(fd.get('email') ?? '').trim(),
    password: String(fd.get('password') ?? ''),
  });
  if (error) return { error: 'Email o contraseña incorrectos.' };
  redirect(safeNext(fd.get('next')));
}

export async function register(_: unknown, fd: FormData) {
  const sb = await supabaseServer();
  const full_name = String(fd.get('full_name') ?? '').trim();
  const join_code = String(fd.get('join_code') ?? '').trim();
  if (!full_name || !join_code) return { error: 'Rellena nombre y código del local.' };
  const { data, error } = await sb.auth.signUp({
    email: String(fd.get('email') ?? '').trim(),
    password: String(fd.get('password') ?? ''),
    options: { data: { full_name, join_code } },
  });
  if (error) {
    if (/Database error/i.test(error.message)) return { error: 'El código del local no es correcto.' };
    if (/password/i.test(error.message)) return { error: 'La contraseña debe tener al menos 6 caracteres.' };
    return { error: error.message };
  }
  if (!data.session) return { ok: 'Cuenta creada. Revisa tu correo para confirmarla y luego entra.' };
  redirect('/');
}

export async function logout() {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect('/login');
}

/** Paso 1: pedir el correo de recuperación. Siempre responde lo mismo (no revela si el correo existe). */
export async function requestReset(_: unknown, fd: FormData) {
  const email = String(fd.get('email') ?? '').trim();
  if (!email) return { error: 'Escribe tu correo.' };
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const sb = await supabaseServer();
  await sb.auth.resetPasswordForEmail(email, { redirectTo: `${proto}://${host}/auth/callback?next=/nueva-contrasena` });
  return { ok: 'Si ese correo tiene cuenta, te llegará un enlace para poner una contraseña nueva. Mira también en spam.' };
}

/** Paso 2 (o desde Mi perfil): poner la contraseña nueva estando ya con sesión. */
export async function updatePassword(_: unknown, fd: FormData) {
  const pw = String(fd.get('password') ?? '');
  const pw2 = String(fd.get('password2') ?? '');
  if (pw.length < 6) return { error: 'La contraseña debe tener al menos 6 caracteres.' };
  if (pw !== pw2) return { error: 'Las dos contraseñas no coinciden.' };
  const sb = await supabaseServer();
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) return { error: /same|different/i.test(error.message) ? 'Tiene que ser distinta de la anterior.' : 'No se ha podido cambiar. Vuelve a pedir el enlace.' };
  if (fd.get('redirect') === '1') redirect('/');
  return { ok: 'Contraseña cambiada.' };
}
