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
import { AbsenceForm, ClearWeekForm } from '../Forms';
import { NoticeList, RuleTaskList } from '../NoticeList';
import { loadNotices, loadRuleTasks } from '@/lib/notices';
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
  const [absences, dayNotices, dayRules] = await Promise.all([loadAbsences(sb, gridFrom, addDays(gridFrom, 41)), loadNotices(sb, day), loadRuleTasks(sb, day)]);
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

  const dayRows = dayShifts.filter((s) => colorById.has(s.user_id));
  const awayWithShift = todayAway.filter((a) => dayRows.some((s) => s.user_id === a.user_id));

  return (
    <>
      <h1>Turnos y calendario</h1>

      <div className="cols">
        <div className="col sticky">
          <MonthCalendar month={month} day={day} shifts={shifts} people={calPeople} absences={absences} />
          <Link className="btn ghost" href={`/horario?w=${mon}`}>Cambiar el horario de la semana {fmtWeek(mon)}</Link>
        </div>
        <div className="col">
          <h2>{fmtLongDay(madridMidnight(day))}</h2>

          {/* ---- Quién trabaja (solo ver: el horario se cambia en Horario) ---- */}
          <DaySlots rows={dayRows} me={me} colorById={colorById} nameById={nameById} absences={todayAway} />
          {awayWithShift.map((a) => (
            <div key={a.id} className="alert err small">
              {(nameById.get(a.user_id) ?? '—').split(' ')[0]} tiene turno puesto y está marcada como {ABSENCE[a.kind].label.toLowerCase()} este día.
              Quítale el turno en <Link href={`/horario?w=${mon}`}>Horario</Link> si no viene.
            </div>
          ))}

          {/* ---- Mensajes y tareas del día ---- */}
          <h2>Mensajes y tareas de este día</h2>
          <RuleTaskList tasks={dayRules} day={day} nameById={nameById} owner />
          <NoticeList notices={dayNotices} nameById={nameById} owner empty={dayRules.length ? undefined : 'No hay mensajes ni tareas para este día.'} />
          <Link className="btn soft" href="/admin#mensajes">+ Mensaje o tarea (en Gestión)</Link>

          {/* ---- Ausencias ---- */}
          <h2>Vacaciones, asuntos propios y bajas</h2>
          {todayAway.length > 0 && (
            <div className="list">
              {todayAway.map((a) => (
                <form key={a.id} action={deleteAbsence} className="row" style={{ gap: 8 }}>
                  <input type="hidden" name="id" value={a.id} />
                  <div>
                    <div className="t">{nameById.get(a.user_id) ?? '—'} · {ABSENCE[a.kind].label}</div>
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
              <div className="small muted">Es solo informativo: se ve en el calendario y en el horario, pero no cambia las horas.</div>
              <AbsenceForm people={team} day={day} />
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
  const [{ data }, { data: profs }, absences, dayNotices, dayRules] = await Promise.all([
    sb.from('shifts')
      .select('id, user_id, starts_at, ends_at, label, note, changed_at, template_id, profiles(full_name)')
      .gte('starts_at', mFrom).lt('starts_at', mTo).order('starts_at'),
    sb.from('profiles').select('id, full_name, color, active, role').order('full_name'),
    loadAbsences(sb, gridFrom, addDays(gridFrom, 41)),
    loadNotices(sb, day),
    loadRuleTasks(sb, day),
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
          {dayNotices.length + dayRules.length > 0 && (
            <>
              <div className="eyebrow" style={{ marginTop: 4 }}>Mensajes y tareas</div>
              <RuleTaskList tasks={dayRules} day={day} nameById={nameById} />
              <NoticeList notices={dayNotices} nameById={nameById} me={me} />
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
    .filter((p) => p.active)
    .sort((a, b) => Number(a.role === 'owner') - Number(b.role === 'owner'))
    .map((p, i) => ({ id: p.id, name: p.full_name.split(' ')[0], color: colorOf(p.color, i) }));
}
