'use client';

import { useActionState } from 'react';
import { saCreateBusiness, saSetAccount, saSetPassword } from '../actions';

type State = { error?: string; ok?: string } | undefined;

export const JOBS = ['Dueño/a', 'Encargado/a', 'Barista', 'Jefe/a de cocina', 'Cocina', 'Sala', 'Pastelería'];

export function AccountForm({ a, me }: {
  a: { user_id: string; full_name: string; email: string; role: string; job_title: string | null; active: boolean; last_sign_in_at: string | null };
  me: boolean;
}) {
  const [state, action, pending] = useActionState<State, FormData>(saSetAccount, undefined);
  return (
    <form action={action} className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, opacity: a.active ? 1 : 0.65 }}>
      <input type="hidden" name="user_id" value={a.user_id} />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <div style={{ minWidth: 0 }}>
          <div className="t">{a.full_name}{me ? ' (tú)' : ''}{!a.active ? ' · de baja' : ''}</div>
          <div className="small" style={{ wordBreak: 'break-all' }}>{a.email}</div>
        </div>
        <span className={`pill ${a.role === 'owner' ? 'dark' : 'ok'}`}>{a.role === 'owner' ? 'Vista admin' : 'Vista equipo'}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'end' }}>
        <label>Puesto
          <input name="job_title" list="jobs" defaultValue={a.job_title ?? ''} placeholder="Barista" />
        </label>
        <label>Vista
          <select name="role" defaultValue={a.role}>
            <option value="owner">Admin (dueños)</option>
            <option value="worker">Equipo</option>
          </select>
        </label>
        <label>Cuenta
          <select name="active" defaultValue={a.active ? '1' : '0'}>
            <option value="1">Activa</option>
            <option value="0">De baja</option>
          </select>
        </label>
        <button className="btn sm" disabled={pending}>Guardar</button>
      </div>
      {state?.error && <div className="alert err">{state.error}</div>}
      {state?.ok && <div className="alert ok">{state.ok}</div>}
    </form>
  );
}

export function NewBusinessForm() {
  const [state, action, pending] = useActionState<State, FormData>(saCreateBusiness, undefined);
  return (
    <form action={action} className="stack">
      <div className="grid2">
        <label>Nombre del local<input name="name" required placeholder="Café Ejemplo" /></label>
        <label>Código de alta<input name="join_code" required placeholder="EJEMPLO2027" autoCapitalize="characters" /></label>
      </div>
      {state?.error && <div className="alert err">{state.error}</div>}
      {state?.ok && <div className="alert ok">{state.ok}</div>}
      <button className="btn" disabled={pending}>Crear local</button>
    </form>
  );
}

export function TempPasswordForm({ userId, name }: { userId: string; name: string }) {
  const [state, action, pending] = useActionState<State, FormData>(saSetPassword, undefined);
  return (
    <details style={{ padding: '0 16px 12px' }}>
      <summary className="small" style={{ cursor: 'pointer', textDecoration: 'underline', color: 'var(--suave)', padding: '6px 0' }}>Contraseña temporal para {name}</summary>
      <form action={action} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
        <input type="hidden" name="user_id" value={userId} />
        <label style={{ flex: '1 1 180px' }}>Contraseña<input name="password" minLength={6} required autoComplete="off" placeholder="Mínimo 6 caracteres" /></label>
        <button className="btn sm" disabled={pending}>Poner</button>
      </form>
      {state?.error && <div className="alert err" style={{ marginTop: 8 }}>{state.error}</div>}
      {state?.ok && <div className="alert ok" style={{ marginTop: 8 }}>{state.ok}</div>}
    </details>
  );
}
