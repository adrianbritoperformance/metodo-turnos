import Link from 'next/link';
import { requireProfile } from '@/lib/supabase';
import {
  addDays, dayRange, fmtHours, fmtLongDay, fmtTime, fmtWeek, madridMidnight, monthName, monthRange,
  mondayOf, shiftMonth, ymd,
} from '@/lib/time';
import { ShiftForm } from '../Forms';
import { copyWeek, deleteShift } from '../actions';
import { TemplateToggle } from './Toggle';

export const dynamic = 'force-dynamic';

type Row = {
  id: string; user_id: string; starts_at: string; ends_at: string; label: string | null; note: string | null;
  changed_at: string | null; template_id: string | null; profiles: { full_name: string } | null;
};
type Tpl = { id: string; name: string; start_time: string; end_time: string };

const WD = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

export default async function Turnos({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { d } = await searchParams;
  const day = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ymd();
  const { sb, profile } = await requireProfile();
  return profile.role === 'owner'
    ? <OwnerPlanner sb={sb} day={day} me={profile.id} />
    : <WorkerView sb={sb} day={day} me={profile.id} />;
}

type SB = Awaited<ReturnType<typeof requireProfile>>['sb'];

/* ======================= Encargada: calendario + Mañana/Tarde ======================= */

async function OwnerPlanner({ sb, day, me }: { sb: SB; day: string; me: string }) {
  const month = day.slice(0, 7);
  const { from: mFrom, to: mTo } = monthRange(month);
  const mon = mondayOf(day);
  const weekFrom = madridMidnight(mon).toISOString();
  const weekTo = madridMidnight(addDays(mon, 7)).toISOString();

  const [{ data: monthShifts }, { data: tpls }, { data: contracts }, { data: weekShifts }] = await Promise.all([
    sb.from('shifts').select('id, user_id, starts_at, ends_at, label, note, changed_at, template_id, profiles(full_name)')
      .gte('starts_at', mFrom).lt('starts_at', mTo).order('starts_at'),
    sb.from('shift_templates').select('id, name, start_time, end_time').order('sort'),
    sb.rpc('get_contracts'),
    sb.from('shift_balance').select('user_id, planned_minutes').gte('starts_at', weekFrom).lt('starts_at', weekTo),
  ]);
  const shifts = (monthShifts ?? []) as unknown as Row[];
  const templates = (tpls ?? []) as Tpl[];
  const people = ((contracts ?? []) as { user_id: string; full_name: string; weekly_hours: number; active: boolean }[])
    .filter((c) => c.active);
  const team = people.map((p) => ({ id: p.user_id, full_name: p.full_name }));

  // Recuento por día para el calendario: { 'YYYY-MM-DD': { tplId: n, other: n } }
  const perDay = new Map<string, Map<string, number>>();
  for (const s of shifts) {
    const k = ymd(s.starts_at);
    const m = perDay.get(k) ?? new Map<string, number>();
    const key = s.template_id ?? 'other';
    m.set(key, (m.get(key) ?? 0) + 1);
    perDay.set(k, m);
  }

  // Celdas del mes empezando en lunes
  const first = `${month}-01`;
  const gridStart = mondayOf(first);
  const nextMonthFirst = `${shiftMonth(month, 1)}-01`;
  const cells: string[] = [];
  for (let c = gridStart; c < nextMonthFirst || cells.length % 7 !== 0; c = addDays(c, 1)) cells.push(c);
  const today = ymd();

  const dayShifts = shifts.filter((s) => ymd(s.starts_at) === day);
  // Si el día elegido no es de este mes (no debería pasar) no hay turnos cargados

  const planned = new Map<string, number>();
  for (const w of (weekShifts ?? []) as { user_id: string; planned_minutes: number }[])
    planned.set(w.user_id, (planned.get(w.user_id) ?? 0) + w.planned_minutes);

  const tplTimes = (t: Tpl) => `${t.start_time.slice(0, 5)}–${t.end_time.slice(0, 5)}`;

  return (
    <>
      <h1>Cuadrante</h1>

      {/* ---- Calendario del mes ---- */}
      <div className="card" style={{ gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link className="btn ghost sm" href={`/turnos?d=${shiftMonth(month, -1)}-01`} aria-label="Mes anterior" style={{ padding: '0 12px' }}>‹</Link>
          <div style={{ fontWeight: 700 }}>{monthName(month)}</div>
          <Link className="btn ghost sm" href={`/turnos?d=${shiftMonth(month, 1)}-01`} aria-label="Mes siguiente" style={{ padding: '0 12px' }}>›</Link>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
          {WD.map((w) => <div key={w} className="small" style={{ textAlign: 'center', color: 'var(--suave)', fontWeight: 700 }}>{w}</div>)}
          {cells.map((c) => {
            const inMonth = c.slice(0, 7) === month;
            const counts = perDay.get(c);
            const sel = c === day;
            return (
              <Link
                key={c}
                href={`/turnos?d=${c}`}
                aria-current={sel ? 'date' : undefined}
                aria-label={`${Number(c.slice(8))}${counts ? `: ${[...counts.values()].reduce((a, b) => a + b, 0)} turnos` : ''}`}
                style={{
                  minHeight: 50, borderRadius: 10, textDecoration: 'none', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 2,
                  background: sel ? 'var(--espresso)' : inMonth ? '#fff' : 'transparent',
                  color: sel ? '#F7EFE4' : inMonth ? 'var(--tinta)' : '#A8917D',
                  border: c === today && !sel ? '2px solid var(--espresso)' : '2px solid transparent',
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 14 }}>{Number(c.slice(8))}</span>
                {counts && inMonth && (
                  <span style={{ fontSize: 10, lineHeight: 1 }}>
                    {templates.map((t) => counts.get(t.id) ? `${t.name[0]}${counts.get(t.id)}` : null).filter(Boolean).join(' ')}
                    {counts.get('other') ? ` +${counts.get('other')}` : ''}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        <div className="small muted">{templates.map((t) => `${t.name[0]} = ${t.name} (${tplTimes(t)})`).join(' · ')}</div>
      </div>

      {/* ---- Día elegido: Mañana / Tarde por compañera ---- */}
      <h2>{fmtLongDay(madridMidnight(day))}</h2>
      {people.length === 0 && <div className="card"><div className="muted">Aún no hay nadie en el equipo.</div></div>}
      <div className="list">
        {people.map((p) => {
          const mine = dayShifts.filter((s) => s.user_id === p.user_id);
          const extra = mine.filter((s) => !s.template_id || !templates.some((t) => t.id === s.template_id));
          return (
            <div key={p.user_id} className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="t">{p.full_name}{p.user_id === me ? ' (tú)' : ''}</span>
                {extra.length > 0 && <span className="small muted">+ {extra.map((s) => `${fmtTime(s.starts_at)}–${fmtTime(s.ends_at)}`).join(', ')}</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {templates.map((t) => {
                  const s = mine.find((x) => x.template_id === t.id);
                  const custom = s && (fmtTime(s.starts_at) !== t.start_time.slice(0, 5) || fmtTime(s.ends_at) !== t.end_time.slice(0, 5))
                    ? `${fmtTime(s.starts_at)}–${fmtTime(s.ends_at)}` : undefined;
                  return (
                    <TemplateToggle key={`${t.id}-${!!s}-${custom ?? ''}`} userId={p.user_id} date={day} templateId={t.id}
                      name={t.name} on={!!s} custom={custom} />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Un toque pone el turno con su horario de siempre; otro lo quita. En amarillo, los que tienen horas cambiadas.
      </p>

      {/* ---- Ajustes finos del día ---- */}
      {dayShifts.length > 0 && (
        <details className="card">
          <summary className="btn ghost">Cambiar horas o poner una tarea</summary>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {dayShifts.map((r) => {
              const tpl = templates.find((t) => t.id === r.template_id);
              return (
                <details key={r.id} className="card" style={{ background: 'var(--crema)' }}>
                  <summary style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 700 }}>{r.profiles?.full_name}{tpl ? ` · ${tpl.name}` : ''}</span>
                    <span className="small" style={{ fontWeight: 700 }}>{fmtTime(r.starts_at)}–{fmtTime(r.ends_at)}</span>
                  </summary>
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <ShiftForm people={team} submit="Guardar cambios" d={{
                      id: r.id, user_id: r.user_id, date: ymd(r.starts_at), start: fmtTime(r.starts_at), end: fmtTime(r.ends_at),
                      label: r.label ?? '', note: r.note ?? '',
                    }} />
                    <form action={deleteShift}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="btn danger" style={{ width: '100%' }}>Borrar este turno</button>
                    </form>
                  </div>
                </details>
              );
            })}
          </div>
        </details>
      )}

      <details className="card">
        <summary className="btn ghost">+ Turno con otro horario</summary>
        <div style={{ marginTop: 12 }}>
          <ShiftForm people={team} d={{ date: day }} />
        </div>
      </details>

      {/* ---- Semana ---- */}
      <h2>Semana {fmtWeek(mon)}</h2>
      <form action={copyWeek} className="card">
        <input type="hidden" name="from" value={addDays(mon, -7)} />
        <input type="hidden" name="to" value={mon} />
        <div className="small muted">Copia los turnos de la semana {fmtWeek(addDays(mon, -7))} a esta. Lo que ya esté puesto no se duplica.</div>
        <button className="btn soft">Copiar semana anterior</button>
      </form>

      {people.length > 0 && (
        <details className="card">
          <summary style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="eyebrow">Horas puestas esta semana</span>
            <span className="small" style={{ textDecoration: 'underline', color: 'var(--suave)' }}>Ver</span>
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
            {people.map((p) => {
              const plan = planned.get(p.user_id) ?? 0;
              const contract = Number(p.weekly_hours) * 60;
              const diff = plan - contract;
              const cls = diff === 0 ? 'ok' : diff > 0 ? 'out' : 'low';
              return (
                <div key={p.user_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--linea)' }}>
                  <span style={{ fontWeight: 700 }}>{p.full_name}</span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="small">{fmtHours(plan)} / {fmtHours(contract)}</span>
                    <span className={`pill ${cls}`}>{diff === 0 ? 'Justo' : diff > 0 ? `+${fmtHours(diff)}` : `−${fmtHours(diff)}`}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </>
  );
}

/* ======================= Trabajadoras: ver el cuadrante ======================= */

async function WorkerView({ sb, day, me }: { sb: SB; day: string; me: string }) {
  const { from, to } = dayRange(day);
  const mon = mondayOf(day);
  const week = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const { data } = await sb.from('shifts')
    .select('id, user_id, starts_at, ends_at, label, note, changed_at, template_id, profiles(full_name)')
    .gte('starts_at', from).lt('starts_at', to).order('starts_at');
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Turnos</h1>
        <Link className="btn ghost sm" href="/turnos">Hoy</Link>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Link className="btn ghost sm" href={`/turnos?d=${addDays(mon, -7)}`} aria-label="Semana anterior" style={{ padding: '0 10px' }}>‹</Link>
        <div className="days" style={{ flex: 1 }}>
          {week.map((w, i) => (
            <Link key={w} href={`/turnos?d=${w}`} className={w === day ? 'on' : ''} aria-current={w === day ? 'date' : undefined}>
              <span>{WD[i]}</span><span>{Number(w.slice(8))}</span>
            </Link>
          ))}
        </div>
        <Link className="btn ghost sm" href={`/turnos?d=${addDays(mon, 7)}`} aria-label="Semana siguiente" style={{ padding: '0 10px' }}>›</Link>
      </div>

      <h2>{fmtLongDay(madridMidnight(day))}</h2>
      {rows.length === 0 && <div className="card"><div className="muted">No hay turnos este día.</div></div>}
      {rows.map((r) => {
        const mine = r.user_id === me;
        const changed = r.changed_at && Date.now() - new Date(r.changed_at).getTime() < 48 * 3600e3;
        return (
          <div key={r.id} className={`card ${mine ? 'yellow' : ''}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{r.profiles?.full_name ?? '—'}{mine ? ' (tú)' : ''}</div>
              <div style={{ fontFamily: 'var(--titulo)', fontWeight: 700 }}>{fmtTime(r.starts_at)}–{fmtTime(r.ends_at)}</div>
            </div>
            {r.label && <div className="muted">{r.label}</div>}
            {r.note && <div style={{ fontSize: 14, whiteSpace: 'pre-line' }}>Tarea: {r.note}</div>}
            {changed && <span className="pill out" style={{ alignSelf: 'flex-start' }}>Cambiado recientemente</span>}
          </div>
        );
      })}
    </>
  );
}
