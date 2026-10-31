'use client';

import { useActionState } from 'react';
import { login, register, requestReset, updatePassword } from './actions';

type State = { error?: string; ok?: string } | undefined;

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<State, FormData>(login, undefined);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="next" value={next} />
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      <label>Contraseña<input name="password" type="password" autoComplete="current-password" required /></label>
      {state?.error && <div className="alert err">{state.error}</div>}
      <button className="btn" disabled={pending}>{pending ? 'Entrando…' : 'Entrar'}</button>
      <a href="/recuperar" className="small" style={{ alignSelf: 'center', padding: '10px 0' }}>¿Olvidaste tu contraseña?</a>
    </form>
  );
}

export function RegisterForm() {
  const [state, action, pending] = useActionState<State, FormData>(register, undefined);
  return (
    <form action={action} className="stack">
      <label>Nombre<input name="full_name" autoComplete="name" required /></label>
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      <label>Contraseña<input name="password" type="password" autoComplete="new-password" minLength={6} required /></label>
      <label>Código del local<input name="join_code" autoCapitalize="characters" required /></label>
      {state?.error && <div className="alert err">{state.error}</div>}
      {state?.ok && <div className="alert ok">{state.ok}</div>}
      <button className="btn" disabled={pending}>{pending ? 'Creando…' : 'Crear cuenta'}</button>
    </form>
  );
}

export function ResetRequestForm() {
  const [state, action, pending] = useActionState<State, FormData>(requestReset, undefined);
  return (
    <form action={action} className="stack">
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      {state?.error && <div className="alert err">{state.error}</div>}
      {state?.ok && <div className="alert ok">{state.ok}</div>}
      <button className="btn" disabled={pending}>{pending ? 'Enviando…' : 'Enviar enlace'}</button>
    </form>
  );
}

export function NewPasswordForm({ afterSave = 'stay' }: { afterSave?: 'stay' | 'home' }) {
  const [state, action, pending] = useActionState<State, FormData>(updatePassword, undefined);
  return (
    <form action={action} className="stack">
      {afterSave === 'home' && <input type="hidden" name="redirect" value="1" />}
      <label>Contraseña nueva<input name="password" type="password" autoComplete="new-password" minLength={6} required /></label>
      <label>Repítela<input name="password2" type="password" autoComplete="new-password" minLength={6} required /></label>
      {state?.error && <div className="alert err">{state.error}</div>}
      {state?.ok && <div className="alert ok">{state.ok}</div>}
      <button className="btn" disabled={pending}>{pending ? 'Guardando…' : 'Guardar contraseña'}</button>
    </form>
  );
}
