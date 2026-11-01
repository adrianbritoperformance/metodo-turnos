'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setBlockPeople } from '../actions';

export type GridCell = { blockId: string; start: string; end: string; people: { id: string; note?: string }[] };
export type GridDay = {
  date: string; label: string; today: boolean; cells: GridCell[];
  outside: { id: string; note: string }[]; away: { id: string; label: string }[];
};
export type GridPerson = {
  id: string; name: string; fullName: string; color: string; owner: boolean; job: string | null;
  planned: number; contract: number | null; before: number | null; after: number | null;
};

const hours = (min: number) => {
  const a = Math.round(Math.abs(min)), h = Math.floor(a / 60), m = a % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
};
const saldo = (min: number) => (Math.abs(min) < 1 ? 'al día' : min > 0 ? `se le deben ${hours(min)}` : `debe ${hours(min)}`);

/** Tabla del horario. Los admins tocan una casilla para elegir quién está en esa franja. */
export function HorarioGrid({ days, people, owner, me }: { days: GridDay[]; people: GridPerson[]; owner: boolean; me: string }) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const [open, setOpen] = useState<{ day: GridDay; cell: GridCell } | null>(null);

  return (
    <>
      <div className="hz" role="table" aria-label="Horario de la semana">
        {days.map((d) => (
          <div key={d.date} className={`hz-day${d.today ? ' today' : ''}`} role="row">
            <div className="hz-head" role="rowheader">
              <div style={{ fontWeight: 700 }}>{d.label}</div>
              {d.away.length > 0 && (
                <div className="small" style={{ color: 'var(--suave)' }}>
                  {d.away.map((a) => `${byId.get(a.id)?.name ?? '—'} · ${a.label}`).join(' · ')}
                </div>
              )}
              {d.cells.length === 0 && <div className="small muted">Cerrado</div>}
            </div>
            <div className="hz-cells" style={{ ['--n' as string]: Math.max(1, d.cells.length) }}>
              {d.cells.map((c) => {
                const mine = c.people.some((p) => p.id === me);
                const body = (
                  <>
                    <span className="hz-time">{c.start}–{c.end}</span>
                    <span className="hz-names">
                      {c.people.length === 0 && <span className="muted small">{owner ? '+ Poner' : '—'}</span>}
                      {c.people.map((p) => {
                        const x = byId.get(p.id);
                        return (
                          <span key={p.id} style={{ color: x?.color, fontWeight: p.id === me ? 800 : 700 }}>
                            {x?.name ?? '—'}{p.note ? <span className="small muted" style={{ fontWeight: 400 }}> ({p.note})</span> : null}
                          </span>
                        );
                      })}
                    </span>
                  </>
                );
                return owner ? (
                  <button key={c.blockId} type="button" className={`hz-cell${mine ? ' mine' : ''}`} role="cell"
                    onClick={() => setOpen({ day: d, cell: c })}
                    aria-label={`${d.label}, ${c.start} a ${c.end}: ${c.people.map((p) => byId.get(p.id)?.name).join(', ') || 'nadie'}. Toca para cambiar`}>
                    {body}
                  </button>
                ) : (
                  <div key={c.blockId} className={`hz-cell${mine ? ' mine' : ''}`} role="cell">{body}</div>
                );
              })}
            </div>
            {d.outside.length > 0 && (
              <div className="hz-outside small">
                Fuera de las franjas: {d.outside.map((o, i) => (
                  <span key={i} style={{ color: byId.get(o.id)?.color, fontWeight: 700 }}>{i > 0 ? ' · ' : ''}{byId.get(o.id)?.name} {o.note}</span>
                ))}
                {owner && <span className="muted"> (se cambia desde Turnos)</span>}
              </div>
            )}
          </div>
        ))}
      </div>

      {open && <CellEditor day={open.day} cell={open.cell} people={people} onClose={() => setOpen(null)} />}
    </>
  );
}

function CellEditor({ day, cell, people, onClose }: { day: GridDay; cell: GridCell; people: GridPerson[]; onClose: () => void }) {
  const initial = cell.people.map((p) => p.id);
  const [picked, setPicked] = useState<string[]>(initial);
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const away = new Map(day.away.map((a) => [a.id, a.label]));

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const changed = picked.length !== initial.length || picked.some((x) => !initial.includes(x));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`${day.label}, ${cell.start} a ${cell.end}`} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <div>
            <div className="eyebrow">{day.label}</div>
            <div className="big" style={{ fontSize: 24 }}>{cell.start} – {cell.end}</div>
          </div>
          <button type="button" className="btn ghost sm" onClick={onClose} style={{ flex: '0 0 auto' }}>Cerrar</button>
        </div>
        <div className="small muted">Marca quién trabaja en esta franja. Las franjas seguidas de una persona se juntan en un solo turno.</div>

        <div className="list" style={{ background: '#fff', maxHeight: '52vh', overflowY: 'auto' }}>
          {people.map((p) => {
            const on = picked.includes(p.id);
            return (
              <label key={p.id} className="row" style={{ cursor: 'pointer', fontWeight: 400, color: 'var(--tinta)', flexDirection: 'row', minHeight: 56 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(p.id)} style={{ minHeight: 0, width: 22, height: 22, accentColor: p.color, flexShrink: 0 }} />
                  <span style={{ width: 12, height: 12, borderRadius: 99, background: p.color, flexShrink: 0 }} aria-hidden="true" />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 700, display: 'block' }}>{p.fullName}</span>
                    <span className="small muted">
                      {p.owner ? 'Admin' : `${hours(p.planned)} de ${hours(p.contract ?? 0)} esta semana · ${saldo(p.before ?? 0)}`}
                      {p.job ? ` · ${p.job}` : ''}
                    </span>
                    {away.has(p.id) && <span className="pill low" style={{ marginLeft: 6 }}>{away.get(p.id)}</span>}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        {msg?.error && <div className="alert err">{msg.error}</div>}
        {msg?.ok && <div className="alert ok">{msg.ok}</div>}
        <button className="btn" type="button" disabled={pending || !changed}
          onClick={() => start(async () => {
            const r = await setBlockPeople(day.date, cell.blockId, initial, picked);
            setMsg(r);
            router.refresh();
            if (!r.error) onClose();
          })}>
          {pending ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}
