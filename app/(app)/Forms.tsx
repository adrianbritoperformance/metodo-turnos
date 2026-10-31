'use client';

import { useActionState, useTransition, useState } from 'react';
import { addStock, clearWeek, closePeriod, requestCorrection, respondClosing, saveShift, setOpening, setStock, voidPunchForm } from './actions';

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

export function AddStockForm({ categories }: { categories: string[] }) {
  const [state, action, pending] = useActionState<State, FormData>(addStock, undefined);
  return (
    <form action={action} className="stack">
      <label>Producto<input name="name" required placeholder="Sirope avellana" /></label>
      <label>Categoría
        <input name="category" list="stock-categories" required placeholder="Elige una o escribe una nueva" />
      </label>
      <datalist id="stock-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <label>Nota (opcional)<input name="place" placeholder="Por ejemplo: cajas de 6 L" /></label>
      <Msg s={state} />
      <button className="btn" disabled={pending}>Añadir</button>
    </form>
  );
}

/** Borrar semana con confirmación en dos pasos. */
export function ClearWeekForm({ monday, label }: { monday: string; label: string }) {
  const [state, action, pending] = useActionState<State, FormData>(clearWeek, undefined);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="card">
      {!confirm ? (
        <button type="button" className="btn danger" onClick={() => setConfirm(true)}>Borrar esta semana</button>
      ) : (
        <form action={(fd) => { setConfirm(false); return action(fd); }} className="stack">
          <input type="hidden" name="monday" value={monday} />
          <div style={{ fontSize: 15 }}>
            ¿Seguro? Se quitan <b>todos los turnos de la semana {label}</b>. Los que ya tengan fichajes se conservan.
          </div>
          <div className="btn-row">
            <button type="button" className="btn ghost" onClick={() => setConfirm(false)}>Cancelar</button>
            <button className="btn danger" disabled={pending}>Sí, borrar semana</button>
          </div>
        </form>
      )}
      <Msg s={state} />
    </div>
  );
}

/** La trabajadora da (o no) su conformidad al cierre de nómina. */
export function RespondClosingForm({ id, status, comment }: { id: string; status: 'pending' | 'agree' | 'disagree'; comment: string | null }) {
  const [state, action, pending] = useActionState<State, FormData>(respondClosing, undefined);
  const [editing, setEditing] = useState(status === 'pending');
  if (!editing) {
    return (
      <div className="card" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div>
          <span className={`pill ${status === 'agree' ? 'ok' : 'out'}`}>{status === 'agree' ? 'Estás conforme' : 'No estás conforme'}</span>
          {comment && <div className="small" style={{ marginTop: 6 }}>“{comment}”</div>}
        </div>
        <button type="button" className="btn ghost sm" onClick={() => setEditing(true)}>Cambiar</button>
      </div>
    );
  }
  return (
    <form action={action} className="card" style={{ gap: 10 }}>
      <input type="hidden" name="id" value={id} />
      <div style={{ fontWeight: 700 }}>¿Estás de acuerdo con este cierre?</div>
      <label>Comentario (opcional)<input name="comment" defaultValue={comment ?? ''} placeholder="Por ejemplo: me salen 2 h más el día 14" /></label>
      <div className="btn-row">
        <button name="agree" value="1" className="btn" disabled={pending}>Conforme</button>
        <button name="agree" value="0" className="btn danger" disabled={pending}>No conforme</button>
      </div>
      <Msg s={state} />
    </form>
  );
}

/** La encargada cierra la nómina de una persona. */
export function ClosePeriodForm({ userId, month, total, paid, note }: {
  userId: string; month: string; total: string; paid?: number; note?: string | null;
}) {
  const [state, action, pending] = useActionState<State, FormData>(closePeriod, undefined);
  const h = paid !== undefined ? `${Math.floor(paid / 60)}:${String(paid % 60).padStart(2, '0')}` : '';
  return (
    <form action={action} className="stack">
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="month" value={month} />
      <div className="small muted">Total acumulado: <b>{total}</b>. Lo que no se pague queda para compensar con descanso.</div>
      <label>Horas que se pagan en esta nómina<input name="paid" defaultValue={h} placeholder="0, 5 o 5:30" inputMode="decimal" /></label>
      <label>Nota (opcional)<input name="note" defaultValue={note ?? ''} placeholder="Por ejemplo: 2 h se compensan el 3 de diciembre" /></label>
      <Msg s={state} />
      <button className="btn" disabled={pending}>{paid !== undefined ? 'Actualizar cierre' : 'Cerrar nómina'}</button>
    </form>
  );
}

/** Saldo inicial acordado (antes de usar la app). */
export function OpeningForm({ userId, minutes, note }: { userId: string; minutes: number; note: string | null }) {
  const [state, action, pending] = useActionState<State, FormData>(setOpening, undefined);
  const sign = minutes < 0 ? '-' : '';
  const a = Math.abs(minutes);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="user_id" value={userId} />
      <div className="grid2">
        <label>Saldo inicial (h)<input name="opening" defaultValue={minutes ? `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}` : '0'} inputMode="text" /></label>
        <label>Motivo<input name="note" defaultValue={note ?? ''} placeholder="Acordado el…" /></label>
      </div>
      <Msg s={state} />
      <button className="btn ghost sm" disabled={pending}>Guardar saldo inicial</button>
    </form>
  );
}

/** La encargada descarta (anula) un fichaje hecho por error, con motivo. */
export function VoidPunchForm({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState<State, FormData>(voidPunchForm, undefined);
  if (state?.ok) return <div className="alert ok">{label}: anulado.</div>;
  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input type="hidden" name="id" value={id} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <label style={{ flex: 1 }}>Motivo · {label}<input name="reason" placeholder="Se equivocó de día" required /></label>
        <button className="btn danger sm" disabled={pending}>Anular</button>
      </div>
      <Msg s={state} />
    </form>
  );
}
