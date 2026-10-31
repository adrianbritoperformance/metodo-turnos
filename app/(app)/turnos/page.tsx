import Link from 'next/link';
import { requireProfile } from '@/lib/supabase';
import {
  addDays, fmtHours, fmtLongDay, fmtTime, fmtWeek, madridMidnight, monthName, monthRange,
  mondayOf, shiftMonth, ymd,
} from '@/lib/time';
import { ShiftForm } from '../Forms';
import { copyWeek, deleteShift } from '../actions';
import { TemplateToggle } from './Toggle';
import { MonthCalendar, type CalPerson } from './MonthCalendar';
import { AbsenceForm, ClearWeekForm, NoticeForm } from '../Forms';
import { NoticeList } from '../NoticeList';
import { loadNotices } from '@/lib/notices';
import { deleteAbsence } from '../actions';
import { DaySlots } from './DaySlots';
import { ABSENCE, absentOn, loadAbsences } from '@/lib/absences';
import { colorOf } from '@/lib/colors';

export const dynamic = 'force-dynamic';

type Row = {
  id: string; user_id: string; starts_at: string; ends_at: string; label: string | null; note: string | null;
  changed_at: string | null; template_id: string | null; profiles: { full_name: string } | null;
};
type Tpl = { id: string; name: string; start_time: string; end_time: string; weekdays: number[] };

/** 1 = lunes … 7 = domingo */
const isoDow = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return ((new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 6) % 7) + 1; };

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

  const [{ data: monthShifts }, { data: tpls }, { data: contracts }, { data: weekShifts }, { data: profs }] = await Promise.all([
    sb.from('shifts').select('id, user_id, starts_at, ends_at, label, note, changed_at, template_id, profiles(full_name)')
      .gte('starts_at', mFrom).lt('starts_at', mTo).order('starts_at'),
    sb.from('shift_templates').select('id, name, start_time, end_time, weekdays').order('sort'),
    sb.rpc('get_contracts'),
    sb.from('shift_balance').select('user_id, planned_minutes').gte('starts_at', weekFrom).lt('starts_at', weekTo),
    sb.from('profiles').select('id, full_name, color, active, role').order('full_name'),
  ]);
  const calPeople = calendarPeople(profs);
  const colorById = new Map(calPeople.map((p) => [p.id, p.color]));
  const gridFrom = mondayOf(`${month}-01`);
  const [absences, dayNotices] = await Promise.all([loadAbsences(sb, gridFrom, addDays(gridFrom, 41)), loadNotices(sb, day)]);
  const todayAway = absentOn(absences, day);
  const nameById = new Map(((profs ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
  const shifts = (monthShifts ?? []) as unknown as Row[];
  const allTemplates = (tpls ?? []) as Tpl[];
  const templates = allTemplates.filter((t) => t.weekdays.includes(isoDow(day)));
  const tplName = new Map(allTemplates.map((t) => [t.id, t.name]));
  const names = [...new Set(allTemplates.map((t) => t.name))];
  // En el cuadrante solo salen las trabajadoras (los admins no hacen turnos).
  const people = ((contracts ?? []) as { user_id: string; full_name: string; weekly_hours: number; active: boolean; role: string }[])
    .filter((c) => c.active && c.role === 'worker');
  const team = people.map((p) => ({ id: p.user_id, full_name: p.full_name }));

  const dayShifts = shifts.filter((s) => ymd(s.starts_at) === day);
  // Si el día elegido no es de este mes (no debería pasar) no hay turnos cargados

  const planned = new Map<string, number>();
  for (const w of (weekShifts ?? []) as { user_id: string; planned_minutes: number }[])
    planned.set(w.user_id, (planned.get(w.user_id) ?? 0) + w.planned_minutes);

  const tplTimes = (t: Tpl) => `${t.start_time.slice(0, 5)}–${t.end_time.slice(0, 5)}`;

  return (
    <>
      <h1>Turnos y calendario</h1>

      <div className="cols">
        <div className="col sticky">
      <MonthCalendar month={month} day={day} shifts={shifts} people={calPeople} absences={absences} />

      {/* ---- Semana ---- */}
      <h2>Semana {fmtWeek(mon)}</h2>
      <form action={copyWeek} className="card">
        <input type="hidden" name="from" value={addDays(mon, -7)} />
        <input type="hidden" name="to" value={mon} />
        <div className="small muted">Copia los turnos de la semana {fmtWeek(addDays(mon, -7))} a esta. Lo que ya esté puesto no se duplica.</div>
        <button className="btn soft">Copiar semana anterior</button>
      </form>
      <ClearWeekForm monday={mon} label={fmtWeek(mon)} />

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
        </div>
        <div className="col">
      {/* ---- Día elegido: Mañana / Tarde por compañera ---- */}
      <h2>{fmtLongDay(madridMidnight(day))}</h2>
      {templates.length > 0 && <div className="small muted">{templates.map((t) => `${t.name} ${tplTimes(t)}`).join(' · ')}</div>}
      {templates.length === 0 && <div className="card"><div className="muted">Este día no hay turnos tipo. Si hace falta, usa “Turno con otro horario”.</div></div>}
      {people.length === 0 && <div className="card"><div className="muted">Aún no hay nadie en el equipo.</div></div>}
      <div className="list">
        {people.map((p) => {
          const mine = dayShifts.filter((s) => s.user_id === p.user_id);
          const extra = mine.filter((s) => !s.template_id || !templates.some((t) => t.id === s.template_id));
          if (templates.length === 0 && mine.length === 0) return null;
          return (
            <div key={p.user_id} className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="t" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 99, background: colorById.get(p.user_id) }} />
                  {p.full_name}{p.user_id === me ? ' (tú)' : ''}
                </span>
                {extra.length > 0 && <span className="small muted">+ {extra.map((s) => `${fmtTime(s.starts_at)}–${fmtTime(s.ends_at)}`).join(', ')}</span>}
                {absentOn(todayAway, day, p.user_id).map((a) => (
                  <span key={a.id} className="pill" style={{ background: ABSENCE[a.kind].bg, color: ABSENCE[a.kind].fg }}>{ABSENCE[a.kind].label}</span>
                ))}
              </div>
              {absentOn(todayAway, day, p.user_id).length > 0 && mine.length > 0 && (
                <div className="alert err small">Tiene turno puesto y está marcada como ausente este día. Quita el turno si no viene.</div>
              )}
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

      {/* ---- Mensajes y tareas del día ---- */}
      <h2>Mensajes y tareas de este día</h2>
      <NoticeList notices={dayNotices} nameById={nameById} owner empty="No hay mensajes ni tareas para este día." />
      <details className="card">
        <summary className="btn soft">+ Mensaje o tarea</summary>
        <div style={{ marginTop: 12 }}><NoticeForm people={team} day={day} /></div>
      </details>

      {/* ---- Ausencias ---- */}
      {todayAway.length > 0 && (
        <div className="list">
          <div className="row" style={{ background: 'var(--papel)' }}><span className="eyebrow">Ausencias este día</span></div>
          {todayAway.map((a) => (
            <form key={a.id} action={deleteAbsence} className="row" style={{ gap: 8 }}>
              <input type="hidden" name="id" value={a.id} />
              <div>
                <div className="t">{team.find((t) => t.id === a.user_id)?.full_name ?? '—'} · {ABSENCE[a.kind].label}</div>
                <div className="small muted">
                  {a.start_date === a.end_date ? 'Solo este día' : `Del ${Number(a.start_date.slice(8))}/${Number(a.start_date.slice(5, 7))} al ${Number(a.end_date.slice(8))}/${Number(a.end_date.slice(5, 7))}`}
                  {a.note ? ` · ${a.note}` : ''}
                </div>
              </div>
              <button className="btn danger sm" aria-label="Quitar ausencia">Quitar</button>
            </form>
          ))}
        </div>
      )}
      <details className="card">
        <summary className="btn ghost">+ Vacaciones, asuntos propios o baja</summary>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="small muted">Es solo informativo: se ve en el calendario y en la nómina, pero no cambia las horas.</div>
          <AbsenceForm people={team} day={day} />
        </div>
      </details>

      {/* ---- Ajustes finos del día ---- */}
      {dayShifts.length > 0 && (
        <details className="card">
          <summary className="btn ghost">Cambiar horas o poner una tarea</summary>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {dayShifts.map((r) => {
              const tpl = allTemplates.find((t) => t.id === r.template_id);
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

        </div>
      </div>
    </>
  );
}

/* ======================= Trabajadoras: ver el cuadrante ======================= */

async function WorkerView({ sb, day, me }: { sb: SB; day: string; me: string }) {
  const month = day.slice(0, 7);
  const { from: mFrom, to: mTo } = monthRange(month);
  const gridFrom = mondayOf(`${month}-01`);
  const [{ data }, { data: profs }, absences, dayNotices] = await Promise.all([
    sb.from('shifts')
      .select('id, user_id, starts_at, ends_at, label, note, changed_at, template_id, profiles(full_name)')
      .gte('starts_at', mFrom).lt('starts_at', mTo).order('starts_at'),
    sb.from('profiles').select('id, full_name, color, active, role').order('full_name'),
    loadAbsences(sb, gridFrom, addDays(gridFrom, 41)),
    loadNotices(sb, day),
  ]);
  const all = (data ?? []) as unknown as Row[];
  const calPeople = calendarPeople(profs);
  const colorById = new Map(calPeople.map((p) => [p.id, p.color]));
  const nameById = new Map(((profs ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
  const rows = all.filter((r) => ymd(r.starts_at) === day);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Turnos y calendario</h1>
        <Link className="btn ghost sm" href="/turnos">Hoy</Link>
      </div>

      <div className="cols">
        <div className="col sticky">
          <MonthCalendar month={month} day={day} shifts={all} people={calPeople} />
        </div>
        <div className="col">
          <h2>{fmtLongDay(madridMidnight(day))}</h2>
          {dayNotices.length > 0 && (
            <>
              <div className="eyebrow" style={{ marginTop: 4 }}>Mensajes y tareas</div>
              <NoticeList notices={dayNotices} nameById={nameById} />
            </>
          )}
          <DaySlots rows={rows} me={me} colorById={colorById} nameById={nameById} absences={absentOn(absences, day, me)} />
        </div>
      </div>
    </>
  );
}

function calendarPeople(profs: unknown): CalPerson[] {
  return ((profs ?? []) as { id: string; full_name: string; color: string | null; active: boolean; role: string }[])
    .filter((p) => p.active && p.role === 'worker')
    .map((p, i) => ({ id: p.id, name: p.full_name.split(' ')[0], color: colorOf(p.color, i) }));
}
