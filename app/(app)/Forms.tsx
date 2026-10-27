'use client';

import { useActionState, useTransition, useState } from 'react';
import { addStock, requestCorrection, saveShift, setStock } from './actions';

type State = { error?: string; ok?: string } | undefined;

function Msg({ s }: { s: State }) {
  if (s?.error) return <div className="alert err" role="alert">{s.error}</div>;
  if (s?.ok) return <div className="alert ok" role="status">{s.ok}</div>;
  return null;
}

export function CorrectionForm({ shifts }: { shifts: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<State, FormData>(requestCorrection, undefined);
  return (
    <form action={action} className="stack">
      <label>Turno
        <select name="shift_id" required defaultValue="">
          <option value="" disabled>Elige el turno</option>
          {shifts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      <div className="grid2">
        <label>Qué olvidaste
          <select name="kind" defaultValue="out">
            <option value="out">Salida</option>
            <option value="in">Entrada</option>
          </select>
        </label>
        <label>Hora real<input name="time" type="time" required /></label>
      </div>
      <label>Motivo (opcional)<input name="reason" placeholder="Se me olvidó fichar al cerrar" /></label>
      <Msg s={state} />
      <button className="btn" disabled={pending}>{pending ? 'Enviando…' : 'Enviar corrección'}</button>
    </form>
  );
}

export type ShiftDefaults = {
  id?: string; user_id?: string; date: string; start?: string; end?: string; label?: string; note?: string;
};

export function ShiftForm({ people, d, submit = 'Guardar turno' }: {
  people: { id: string; full_name: string }[]; d: ShiftDefaults; submit?: string;
}) {
  const [state, action, pending] = useActionState<State, FormData>(saveShift, undefined);
  return (
    <form action={action} className="stack">
      {d.id && <input type="hidden" name="id" value={d.id} />}
      <label>Persona
        <select name="user_id" required defaultValue={d.user_id ?? ''}>
          <option value="" disabled>Elige</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
      </label>
      <label>Día<input name="date" type="date" required defaultValue={d.date} /></label>
      <div className="grid2">
        <label>Entrada<input name="start" type="time" required defaultValue={d.start ?? '08:30'} /></label>
        <label>Salida<input name="end" type="time" required defaultValue={d.end ?? '13:30'} /></label>
      </div>
      <label>Puesto (opcional)<input name="label" defaultValue={d.label} placeholder="Barra + apertura" /></label>
      <label>Tarea o mensaje (opcional)<textarea name="note" defaultValue={d.note} placeholder="Al cierre: limpiar molinos" /></label>
      <Msg s={state} />
      <button className="btn" disabled={pending}>{pending ? 'Guardando…' : submit}</button>
    </form>
  );
}

const LOOKS = [
  { label: 'Hay', cls: 'ok' },
  { label: 'Queda poco', cls: 'low' },
  { label: 'Falta', cls: 'out' },
];

export function StockRow({ id, name, place, status, updatedBy }: {
  id: string; name: string; place: string | null; status: number; updatedBy?: string;
}) {
  const [s, setS] = useState(status);
  const [, start] = useTransition();
  const look = LOOKS[s];
  return (
    <button
      type="button"
      className="row"
      style={{ width: '100%', background: 'transparent', border: 0, borderBottom: '1px solid var(--linea)', textAlign: 'left', cursor: 'pointer', minHeight: 60 }}
      onClick={() => {
        const n = (s + 1) % 3;
        setS(n);
        start(() => setStock(id, n));
      }}
      aria-label={`${name}: ${look.label}. Toca para cambiar`}
    >
      <div>
        <div className="t">{name}</div>
        <div className="muted small">{[place, s > 0 && updatedBy ? `marcado por ${updatedBy}` : null].filter(Boolean).join(' · ')}</div>
      </div>
      <span className={`pill ${look.cls}`}>{look.label}</span>
    </button>
  );
}

export function AddStockForm() {
  const [state, action, pending] = useActionState<State, FormData>(addStock, undefined);
  return (
    <form action={action} className="stack">
      <label>Producto<input name="name" required placeholder="Leche entera" /></label>
      <label>Dónde / formato (opcional)<input name="place" placeholder="Barra · cajas de 6 L" /></label>
      <Msg s={state} />
      <button className="btn" disabled={pending}>Añadir</button>
    </form>
  );
}
