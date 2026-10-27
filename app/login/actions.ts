'use server';

import { redirect } from 'next/navigation';
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
