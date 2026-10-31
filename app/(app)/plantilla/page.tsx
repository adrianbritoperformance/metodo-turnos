import Link from 'next/link';
import { requireOwner } from '@/lib/supabase';
import { addDays, fmtHours, fmtTime, fmtWeek, madridMidnight, mondayOf, ymd } from '@/lib/time';
import { ABSENCE, absentOn, loadAbsences } from '@/lib/absences';
import { colorOf } from '@/lib/colors';
import { ClearWeekForm } from '../Forms';
import { copyWeek, setContract } from '../actions';
import { WeekEditor, type EditorDay, type UsualMap } from './WeekEditor';

export const dynamic = 'force-dynamic';

type Tpl = { id: string; name: string; start_time: string; end_time: string; weekdays: number[] };
type Shift = { id: string; user_id: string; starts_at: string; ends_at: string; template_id: string | null };
type Bal = { shift_id: string; user_id: string; planned_minutes: number; extra_minutes: number | null; real_in: string | null; ends_at: string };

const WD = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const dm = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const dayLabel = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return dm.format(new Date(Date.UTC(y, m - 1, dd))).replace('.', ''); };

/** Plantilla: se elige una persona y se le hace el horario de la semana (Mañana / Tarde con horas a medida). */
export default async function Plantilla({ searchParams }: { searchParams: Promise<{ w?: string; u?: string; v?: string }> }) {
  const { w, u, v } = await searchParams;
  const view = v === 'habitual' ? 'habitual' : 'semana';
  const { sb } = await requireOwner();
  const mon = mondayOf(w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? w : ymd());
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const from = madridMidnight(mon).toISOString();
  const to = madridMidnight(addDays(mon, 7)).toISOString();
  const today = ymd();

  const [{ data: shiftRows }, { data: balRows }, { data: tpls }, { data: contracts }, { data: profs }, absences] = await Promise.all([
    sb.from('shifts').select('id, user_id, starts_at, ends_at, template_id').gte('starts_at', from).lt('starts_at', to).order('starts_at'),
    sb.from('shift_balance').select('shift_id, user_id, planned_minutes, extra_minutes, real_in, ends_at').gte('starts_at', from).lt('starts_at', to),
    sb.from('shift_templates').select('id, name, start_time, end_time, weekdays').order('sort'),
    sb.rpc('get_contracts'),
    sb.from('profiles').select('id, color, active, role').order('full_name'),
    loadAbsences(sb, mon, addDays(mon, 6)),
  ]);
  const shifts = (shiftRows ?? []) as Shift[];
  const bal = new Map(((balRows ?? []) as Bal[]).map((b) => [b.shift_id, b]));
  const templates = (tpls ?? []) as Tpl[];
  const workers = ((contracts ?? []) as { user_id: string; full_name: string; weekly_hours: number; active: boolean; role: string }[])
    .filter((c) => c.active && c.role === 'worker');
  const colorById = new Map(((profs ?? []) as { id: string; color: string | null; active: boolean; role: string }[])
    .filter((p) => p.active && p.role === 'worker').map((p, i) => [p.id, colorOf(p.color, i)]));
  const sel = workers.find((x) => x.user_id === u);
  const { data: usualRows } = sel
    ? await sb.from('usual_slots').select('weekday, template_id, start_time, end_time').eq('user_id', sel.user_id)
    : { data: [] };
  const usual: UsualMap = Object.fromEntries(((usualRows ?? []) as { weekday: number; template_id: string; start_time: string; end_time: string }[])
    .map((r) => [`${r.weekday}|${r.template_id}`, { start: r.start_time.slice(0, 5), end: r.end_time.slice(0, 5) }]));
  const link = (week: string, user?: string) => `/plantilla?w=${week}${user ? `&u=${user}` : ''}`;

  const summary = (userId: string, weekly: number) => {
    const mine = shifts.filter((s) => s.user_id === userId);
    const plan = mine.reduce((a, s) => a + (bal.get(s.id)?.planned_minutes ?? 0), 0);
    const extra = mine.reduce((a, s) => a + (bal.get(s.id)?.extra_minutes ?? 0), 0);
    return { plan, extra, contract: Math.round(weekly * 60) };
  };

  // Datos del editor para la persona elegida
  let editor: { days: EditorDay[]; extra: number; contract: number } | null = null;
  if (sel) {
    const mine = shifts.filter((s) => s.user_id === sel.user_id);
    const s0 = summary(sel.user_id, Number(sel.weekly_hours));
    editor = {
      extra: s0.extra,
      contract: s0.contract,
      days: days.map((d, i) => {
        const dayTpls = templates.filter((t) => t.weekdays.includes(i + 1));
        const dayShifts = mine.filter((s) => ymd(s.starts_at) === d);
        const away = absentOn(absences, d, sel.user_id)[0];
        const loose = dayShifts.filter((s) => !s.template_id || !dayTpls.some((t) => t.id === s.template_id));
        return {
          date: d,
          weekday: i + 1,
          extrasMinutes: loose.reduce((a, s) => a + (bal.get(s.id)?.planned_minutes ?? 0), 0),
          title: `${WD[i]} ${dayLabel(d)}`,
          today: d === today,
          absence: away ? ABSENCE[away.kind].label : undefined,
          extras: loose.map((s) => `${fmtTime(s.starts_at)}–${fmtTime(s.ends_at)}`),
          slots: dayTpls.map((t) => {
            const s = dayShifts.find((x) => x.template_id === t.id);
            const b = s ? bal.get(s.id) : undefined;
            return {
              template: t.id, name: t.name,
              defStart: t.start_time.slice(0, 5), defEnd: t.end_time.slice(0, 5),
              on: !!s,
              start: s ? fmtTime(s.starts_at) : t.start_time.slice(0, 5),
              end: s ? fmtTime(s.ends_at) : t.end_time.slice(0, 5),
              locked: !!(b?.real_in && new Date(b.ends_at).getTime() < Date.now()),
            };
          }),
        };
      }),
    };
  }

  const usualDays: EditorDay[] = WD.map((name, i) => ({
    date: `w${i + 1}`, weekday: i + 1, title: name, today: false, extras: [], extrasMinutes: 0,
    slots: templates.filter((t) => t.weekdays.includes(i + 1)).map((t) => {
      const x = usual[`${i + 1}|${t.id}`];
      return { template: t.id, name: t.name, defStart: t.start_time.slice(0, 5), defEnd: t.end_time.slice(0, 5),
        on: !!x, start: x?.start ?? t.start_time.slice(0, 5), end: x?.end ?? t.end_time.slice(0, 5), locked: false };
    }),
  }));

  return (
    <>
      <h1>Plantilla</h1>

      <div className="btn-row" style={{ alignItems: 'center', maxWidth: 640 }}>
        <Link className="btn ghost sm" href={link(addDays(mon, -7), sel?.user_id)} style={{ flex: '0 0 auto' }} aria-label="Semana anterior">‹</Link>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 700 }}>Semana {fmtWeek(mon)}</div>
          {mondayOf(today) !== mon && <Link href={link(mondayOf(today), sel?.user_id)} className="small">Ir a esta semana</Link>}
        </div>
        <Link className="btn ghost sm" href={link(addDays(mon, 7), sel?.user_id)} style={{ flex: '0 0 auto' }} aria-label="Semana siguiente">›</Link>
      </div>

      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Elige a quién hacer el horario</div>
        {workers.length === 0 && <div className="card"><div className="muted">Aún no hay trabajadoras en el equipo.</div></div>}
        <nav aria-label="Trabajadoras" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {workers.map((p) => {
            const s = summary(p.user_id, Number(p.weekly_hours));
            const over = s.plan > s.contract;
            const on = sel?.user_id === p.user_id;
            return (
              <Link key={p.user_id} href={link(mon, p.user_id)} aria-current={on ? 'page' : undefined}
                className={on ? 'btn sm' : 'btn ghost sm'} style={{ gap: 8 }}>
                <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 99, background: colorById.get(p.user_id) }} />
                {p.full_name.split(' ')[0]}
                <span style={{ fontWeight: 400, fontSize: 12, color: on ? '#F1E3B3' : over ? 'var(--terracota)' : 'var(--suave)' }}>
                  {fmtHours(s.plan)}/{fmtHours(s.contract)}{over ? ' ▲' : ''}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>

      {!sel && workers.length > 0 && (
        <>
          <div className="list" style={{ maxWidth: 760 }}>
            <div className="row" style={{ background: 'var(--mantequilla)' }}>
              <span className="eyebrow" style={{ color: 'var(--espresso)' }}>Resumen de la semana</span>
              <span className="small muted">puestas / contrato</span>
            </div>
            {workers.map((p) => {
              const s = summary(p.user_id, Number(p.weekly_hours));
              const diff = s.plan - s.contract;
              return (
                <Link key={p.user_id} href={link(mon, p.user_id)} className="row" style={{ textDecoration: 'none', color: 'var(--tinta)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                    <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 99, background: colorById.get(p.user_id) }} />
                    {p.full_name}
                  </span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="small">{fmtHours(s.plan)} / {fmtHours(s.contract)}</span>
                    <span className={`pill ${diff === 0 ? 'ok' : diff > 0 ? 'out' : 'low'}`}>
                      {diff === 0 ? 'Justo' : diff > 0 ? `+${fmtHours(diff)}` : `−${fmtHours(diff)}`}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
          <div className="cols">
            <form action={copyWeek} className="card">
              <input type="hidden" name="from" value={addDays(mon, -7)} />
              <input type="hidden" name="to" value={mon} />
              <div className="small muted">Copia la semana {fmtWeek(addDays(mon, -7))} de todo el equipo en esta. Lo que ya esté puesto no se duplica.</div>
              <button className="btn soft">Copiar semana anterior</button>
            </form>
            <ClearWeekForm monday={mon} label={fmtWeek(mon)} />
          </div>
        </>
      )}

      {sel && editor && (
        <nav aria-label="Vista" className="btn-row" style={{ maxWidth: 520 }}>
          <Link href={`${link(mon, sel.user_id)}`} aria-current={view === 'semana' ? 'page' : undefined}
            className={view === 'semana' ? 'btn sm' : 'btn ghost sm'}>Semana {fmtWeek(mon)}</Link>
          <Link href={`${link(mon, sel.user_id)}&v=habitual`} aria-current={view === 'habitual' ? 'page' : undefined}
            className={view === 'habitual' ? 'btn sm' : 'btn ghost sm'}>Horario habitual</Link>
        </nav>
      )}

      {sel && editor && (
        <div className="cols wide-left">
          <div className="col">
            {view === 'semana' ? (
              <WeekEditor key={`${sel.user_id}-${mon}`} userId={sel.user_id} name={sel.full_name.split(' ')[0]}
                days={editor.days} contractMinutes={editor.contract} extraMinutes={editor.extra} usual={usual} />
            ) : (
              <WeekEditor key={`${sel.user_id}-habitual`} mode="usual" userId={sel.user_id} name={sel.full_name.split(' ')[0]}
                days={usualDays} contractMinutes={editor.contract} />
            )}
          </div>
          <div className="col sticky">
            <form action={setContract} className="card" style={{ gap: 10 }}>
              <input type="hidden" name="id" value={sel.user_id} />
              <div className="eyebrow">Contrato de {sel.full_name.split(' ')[0]}</div>
              <label>Horas por semana
                <input name="weekly_hours" type="number" min={0} max={60} step={0.5} defaultValue={Number(sel.weekly_hours)} inputMode="decimal" />
              </label>
              <button className="btn ghost sm">Guardar contrato</button>
            </form>
            <div className="card">
              <div className="small muted">
                {view === 'semana' ? (
                  <>Pulsa <b>Aplicar horario habitual</b>, cambia lo que sea distinto esta semana y dale a <b>Guardar semana</b>.
                  {' '}{sel.full_name.split(' ')[0]} lo verá en su Inicio y en su calendario, y contará en su bolsa de horas.</>
                ) : (
                  <>Su horario de siempre: qué días viene y a qué horas. No pone turnos por sí solo; sirve para rellenar cada semana de un toque.</>
                )}
              </div>
            </div>
            <Link href={link(mon)} className="btn ghost">Ver resumen de todo el equipo</Link>
          </div>
        </div>
      )}
    </>
  );
}
