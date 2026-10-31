'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveUsual, saveWeekPlan } from '../actions';

export type EditorSlot = {
  template: string; name: string; defStart: string; defEnd: string;
  on: boolean; start: string; end: string; locked: boolean;
};
export type EditorDay = {
  date: string; weekday: number; title: string; slots: EditorSlot[]; absence?: string;
  extras: string[]; extrasMinutes: number; today: boolean;
};
export type UsualMap = Record<string, { start: string; end: string }>; // clave: `${weekday}|${template}`

const mins = (a: string, b: string) => {
  const [h1, m1] = a.split(':').map(Number);
  const [h2, m2] = b.split(':').map(Number);
  let d = h2 * 60 + m2 - (h1 * 60 + m1);
  if (d <= 0) d += 24 * 60;
  return d;
};
const hhmm = (m: number) => { const a = Math.abs(Math.round(m)); const h = Math.floor(a / 60); const r = a % 60; return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`; };

type State = { error?: string; ok?: string } | undefined;

/** Editor de la semana de UNA persona: cada día con Mañana y Tarde, horas a medida y total en vivo. */
export function WeekEditor({ userId, name, days, contractMinutes, extraMinutes = 0, mode = 'week', usual }: {
  userId: string; name: string; days: EditorDay[]; contractMinutes: number; extraMinutes?: number;
  mode?: 'week' | 'usual'; usual?: UsualMap;
}) {
  const initial = useMemo(() => days.map((d) => d.slots.map((s) => ({ ...s }))), [days]);
  const [grid, setGrid] = useState(initial);
  const [state, action, pending] = useActionState<State, FormData>(mode === 'usual' ? saveUsual : saveWeekPlan, undefined);
  const router = useRouter();
  useEffect(() => { setGrid(initial); }, [initial]);
  useEffect(() => { if (state?.ok || state?.error) router.refresh(); }, [state, router]);

  const set = (di: number, si: number, patch: Partial<EditorSlot>) =>
    setGrid((g) => g.map((row, i) => (i !== di ? row : row.map((s, j) => (j !== si ? s : { ...s, ...patch })))));

  const planned = grid.flat().reduce((a, s) => a + (s.on ? mins(s.start, s.end) : 0), 0) + days.reduce((a, d) => a + d.extrasMinutes, 0);
  const hasUsual = !!usual && Object.keys(usual).length > 0;
  const applyUsual = () => setGrid((g) => g.map((row, di) => row.map((s) => {
    if (s.locked || !usual) return s;
    const u = usual[`${days[di].weekday}|${s.template}`];
    return u ? { ...s, on: true, start: u.start, end: u.end } : { ...s, on: false };
  })));
  const diff = planned - contractMinutes;
  const dirty = JSON.stringify(grid) !== JSON.stringify(initial);

  const usualRows = grid.flatMap((row, di) => row.map((s) => ({ weekday: days[di].weekday, template: s.template, on: s.on, start: s.start, end: s.end })));
  const changes = grid.flatMap((row, di) => row.map((s, si) => ({ s, o: initial[di][si], d: days[di] })))
    .filter(({ s, o }) => s.on !== o.on || (s.on && (s.start !== o.start || s.end !== o.end)))
    .map(({ s, d }) => ({ date: d.date, template: s.template, on: s.on, start: s.start, end: s.end, label: `${d.title} ${s.name}` }));

  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="slots" value={JSON.stringify(mode === 'usual' ? usualRows : changes)} />

      {mode === 'week' && (
        <div className="card" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="small muted" style={{ flex: '1 1 220px' }}>
            {hasUsual ? 'Rellena la semana con su horario habitual y luego cambia lo que sea distinto.' : 'Aún no tiene horario habitual. Créalo en la pestaña “Horario habitual”.'}
          </div>
          <button type="button" className="btn soft sm" disabled={!hasUsual} onClick={applyUsual}>Aplicar horario habitual</button>
        </div>
      )}

      <div className="card" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between',
        background: diff > 0 ? 'var(--terracota-bg)' : 'var(--papel)' }}>
        <div>
          <div className="eyebrow">{mode === 'usual' ? `Horario habitual de ${name}` : `Horas de ${name} esta semana`}</div>
          <div className="big" style={{ fontSize: 26 }}>{hhmm(planned)} <span className="small muted" style={{ fontWeight: 400 }}>de {hhmm(contractMinutes)}</span></div>
          {extraMinutes > 0 && <div className="small">Ya lleva <b>+{extraMinutes} min</b> por salir tarde esta semana.</div>}
        </div>
        <span className={`pill ${diff === 0 ? 'ok' : diff > 0 ? 'out' : 'low'}`} style={{ fontSize: 14 }}>
          {diff === 0 ? 'Justo su contrato' : diff > 0 ? `+${hhmm(diff)} sobre su contrato` : `Faltan ${hhmm(diff)}`}
        </span>
      </div>

      <div className="list">
        {days.map((d, di) => (
          <div key={d.date} className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, background: d.today ? '#FBF3D6' : undefined }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <span className="t">{d.title}</span>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {d.absence && <span className="pill out">{d.absence}</span>}
                {d.extras.map((x) => <span key={x} className="pill low">Otro: {x}</span>)}
                <span className="small muted">{hhmm(grid[di].reduce((a, s) => a + (s.on ? mins(s.start, s.end) : 0), 0))}</span>
              </span>
            </div>
            {d.slots.length === 0 && <div className="small muted">Este día no hay turnos.</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
              {grid[di].map((s, si) => (
                <fieldset key={s.template} disabled={s.locked} style={{
                  border: s.on ? '2px solid var(--espresso)' : '2px dashed #C9B49F', borderRadius: 12, padding: '8px 10px', margin: 0,
                  background: s.on ? '#fff' : 'transparent', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                }}>
                  <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, color: 'var(--tinta)', minHeight: 44, minWidth: 90 }}>
                    <input type="checkbox" checked={s.on} onChange={(e) => set(di, si, { on: e.target.checked })}
                      style={{ minHeight: 0, width: 22, height: 22 }} />
                    {s.name}
                  </label>
                  {s.on && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="time" aria-label={`${d.title} ${s.name} entrada`} value={s.start} onChange={(e) => set(di, si, { start: e.target.value })}
                        style={{ minHeight: 40, padding: '4px 6px', width: 108 }} />
                      <span aria-hidden="true">–</span>
                      <input type="time" aria-label={`${d.title} ${s.name} salida`} value={s.end} onChange={(e) => set(di, si, { end: e.target.value })}
                        style={{ minHeight: 40, padding: '4px 6px', width: 108 }} />
                    </span>
                  )}
                  {s.locked && <span className="small muted">Fichado: no se cambia</span>}
                  {s.on && !s.locked && (s.start !== s.defStart || s.end !== s.defEnd) && (
                    <button type="button" className="small" onClick={() => set(di, si, { start: s.defStart, end: s.defEnd })}
                      style={{ background: 'none', border: 0, textDecoration: 'underline', color: 'var(--suave)', cursor: 'pointer', minHeight: 36 }}>
                      Horario de siempre
                    </button>
                  )}
                </fieldset>
              ))}
            </div>
          </div>
        ))}
      </div>

      {state?.error && <div className="alert err" role="alert">{state.error}</div>}
      {state?.ok && <div className="alert ok" role="status">{state.ok}</div>}
      <div className="btn-row" style={{ position: 'sticky', bottom: 84, zIndex: 2 }}>
        <button type="button" className="btn ghost" disabled={!dirty || pending} onClick={() => setGrid(initial)}>Deshacer cambios</button>
        <button className="btn" disabled={!dirty || pending}>
          {pending ? 'Guardando…' : !dirty ? 'Sin cambios' : mode === 'usual' ? 'Guardar horario habitual' : `Guardar semana (${changes.length})`}
        </button>
      </div>
    </form>
  );
}
