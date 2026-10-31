import Link from 'next/link';
import { requireProfile } from '@/lib/supabase';
import { addDays, dayRange, fmtHours, fmtTime, payMonthOf, shiftMonth, TZ, ymd } from '@/lib/time';
import { ABSENCE, absentOn, loadAbsences } from '@/lib/absences';
import { loadNotices } from '@/lib/notices';
import { getPayStartDay } from '@/lib/period';
import { colorOf } from '@/lib/colors';
import { Scanner } from './Scanner';
import { VoidRecent } from './VoidRecent';
import { NoticeList } from './NoticeList';
import { DaySlots } from './turnos/DaySlots';

const dayTitle = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, weekday: 'long', day: 'numeric' });

type Shift = {
  id: string; user_id: string; starts_at: string; ends_at: string; label: string | null; note: string | null;
  changed_at: string | null; profiles: { full_name: string } | null;
};

/** Pantalla de Inicio: lo de hoy de un vistazo (y, para admins, el estado del equipo). */
export async function Home({ autoCode }: { autoCode?: string }) {
  const { sb, profile } = await requireProfile();
  const owner = profile.role === 'owner';
  const today = ymd();
  const { from, to } = dayRange(today);
  const { from: weekFrom } = dayRange(addDays(today, 1));
  const { to: weekTo } = dayRange(addDays(today, 7));

  const [{ data: teamToday }, { data: last }, { data: upcoming }, absences, notices, { data: profs }] = await Promise.all([
    sb.from('shifts').select('id, user_id, starts_at, ends_at, label, note, changed_at, profiles(full_name)')
      .gte('starts_at', from).lt('starts_at', to).order('starts_at'),
    sb.from('punches').select('id, kind, at, created_at').eq('user_id', profile.id).is('voided_at', null)
      .gte('at', new Date(Date.now() - 16 * 3600e3).toISOString()).order('at', { ascending: false }).limit(1),
    sb.from('shifts').select('id, user_id, starts_at, ends_at, label, note, changed_at, profiles(full_name)')
      .eq('user_id', profile.id).gte('starts_at', weekFrom).lt('starts_at', weekTo).order('starts_at'),
    loadAbsences(sb, today, addDays(today, 7)),
    loadNotices(sb, today),
    sb.from('profiles').select('id, full_name, color, active, role').order('full_name'),
  ]);

  const team = (teamToday ?? []) as unknown as Shift[];
  const shifts = team.filter((s) => s.user_id === profile.id);
  const next = (upcoming ?? []) as unknown as Shift[];
  const myAbs = absences.filter((a) => a.user_id === profile.id);
  const awayToday = absentOn(myAbs, today)[0];
  const allProfiles = (profs ?? []) as { id: string; full_name: string; color: string | null; active: boolean; role: string }[];
  const nameById = new Map(allProfiles.map((p) => [p.id, p.full_name]));
  const colorById = new Map(allProfiles.filter((p) => p.active && p.role === 'worker').map((p, i) => [p.id, colorOf(p.color, i)]));
  const myNotices = notices.filter((n) => n.user_ids.length === 0 || n.user_ids.includes(profile.id));
  // Pendiente = mensajes de hoy + tareas sin hacer + tareas del turno
  const pendingCount = myNotices.filter((n) => n.kind === 'mensaje' || !n.done_at).length + shifts.filter((s) => s.note).length;

  const nextKind: 'in' | 'out' = last?.[0]?.kind === 'in' ? 'out' : 'in';
  const recentlyChanged = (s: Shift) => s.changed_at && Date.now() - new Date(s.changed_at).getTime() < 48 * 3600e3;
  const firstName = profile.full_name.split(' ')[0];
  const minutes = shifts.reduce((a, s) => a + (new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000, 0);

  // Próximos días agrupados: "Miércoles 28 · 8:30–13:30 / 16:00–20:00"
  const short = (iso: string) => fmtTime(iso).replace(/^0/, '');
  const byDay = new Map<string, Shift[]>();
  for (const s of next) byDay.set(ymd(s.starts_at), [...(byDay.get(ymd(s.starts_at)) ?? []), s]);
  const titleOf = (day: string) => dayTitle.format(new Date(`${day}T12:00:00Z`)).replace(/^./, (c) => c.toUpperCase()).replace(',', '');
  const days = new Set<string>([...byDay.keys()]);
  for (let i = 1; i <= 7; i++) { const d = addDays(today, i); if (absentOn(myAbs, d).length) days.add(d); }
  const nextDays = [...days].sort().map((day) => {
    const list = byDay.get(day) ?? [];
    return {
      day, title: titleOf(day),
      hours: list.map((s) => `${short(s.starts_at)}–${short(s.ends_at)}`).join(' / '),
      minutes: list.reduce((a, s) => a + (new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000, 0),
      changed: list.some((s) => recentlyChanged(s)),
      away: absentOn(myAbs, day)[0],
    };
  });

  // Admins (dueños): no fichan ni tienen horas propias; su Inicio es el estado del equipo.
  if (owner) {
    return (
      <>
        <h1>Hola, {firstName}</h1>
        <div className="cols">
          <div className="col">
            <OwnerToday sb={sb} today={today} absences={absentOn(absences, today)} notices={notices} nameById={nameById} />
          </div>
          <div className="col">
            <h2>Quién está hoy</h2>
            <DaySlots rows={team} me={profile.id} colorById={colorById} nameById={nameById} absences={absentOn(absences, today)} />
          </div>
        </div>
      </>
    );
  }

  // Fichar va abajo del todo; si se llega escaneando el QR con la cámara del móvil, va arriba para ver el resultado.
  const fichar = (
      <section id="fichar" aria-label="Fichar" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8, width: '100%', maxWidth: 720 }}>
        <h2>Fichar</h2>
        {last?.[0] && Date.now() - new Date(last[0].created_at).getTime() < 10 * 60e3 && (
          <div className="card">
            <div className="muted">{last[0].kind === 'in' ? 'Entrada' : 'Salida'} fichada a las <b>{fmtTime(last[0].at)}</b>.</div>
            <VoidRecent id={last[0].id} />
          </div>
        )}
        {last?.[0]?.kind === 'in' && Date.now() - new Date(last[0].created_at).getTime() >= 10 * 60e3 && (
          <div className="muted">Entrada fichada a las <b>{fmtTime(last[0].at)}</b>.</div>
        )}

        <Scanner nextKind={nextKind} autoCode={autoCode} />
      </section>
  );

  return (
    <>
      <h1>Hola, {firstName}</h1>
      {autoCode && fichar}
      <div className="cols">
        {/* ================= Lo mío de hoy ================= */}
        <div className="col">
          {awayToday ? (
            <div className="card" style={{ background: ABSENCE[awayToday.kind].bg }}>
              <div className="eyebrow" style={{ color: ABSENCE[awayToday.kind].fg }}>Hoy</div>
              <div className="big" style={{ fontSize: 26, color: ABSENCE[awayToday.kind].fg }}>{ABSENCE[awayToday.kind].label}</div>
              {awayToday.end_date > today && (
                <div className="small" style={{ color: ABSENCE[awayToday.kind].fg }}>Hasta el {Number(awayToday.end_date.slice(8))}/{Number(awayToday.end_date.slice(5, 7))}</div>
              )}
            </div>
          ) : shifts.length === 0 ? (
            <div className="card yellow">
              <div className="eyebrow">Hoy</div>
              <div className="big" style={{ fontSize: 26 }}>Descanso</div>
              <div className="muted small">No tienes turno hoy.</div>
            </div>
          ) : (
            <div className="card yellow">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <div className="eyebrow">Hoy trabajas · {fmtHours(minutes)}</div>
                {shifts.some(recentlyChanged) && <span className="pill out">Turno cambiado</span>}
              </div>
              <div className="big" style={{ display: 'flex', flexWrap: 'wrap', columnGap: 14 }}>
                {shifts.map((s, i) => (
                  <span key={s.id}>{i > 0 && <span style={{ opacity: .4, marginRight: 14 }}>/</span>}{fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</span>
                ))}
              </div>
              {shifts.some((s) => s.label) && <div className="muted">{shifts.map((s) => s.label).filter(Boolean).join(' · ')}</div>}
            </div>
          )}

          <h2>Mensajes y tareas de hoy</h2>
          {pendingCount === 0 && (
            <div className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--verde)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
              <div className="muted">No tienes mensajes ni tareas pendientes.</div>
            </div>
          )}
          <NoticeList notices={myNotices} nameById={nameById} />
          {shifts.filter((s) => s.note).map((s) => (
            <div key={s.id + 'n'} className="card">
              <span className="pill low" style={{ alignSelf: 'flex-start' }}>Tarea del turno</span>
              <div style={{ fontSize: 15, whiteSpace: 'pre-line' }}>{s.note}</div>
            </div>
          ))}


          <h2>Tus próximos días</h2>
          {nextDays.length === 0 && <div className="card"><div className="muted">No tienes más turnos esta semana.</div></div>}
          {nextDays.length > 0 && (
            <div className="list">
              {nextDays.map((d) => (
                <div key={d.day} className="row">
                  <div>
                    <div className="t">{d.title}</div>
                    {d.minutes > 0 && <div className="muted small">{fmtHours(d.minutes)}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {d.changed && <span className="pill out">Cambiado</span>}
                    {d.away && <span className="pill" style={{ background: ABSENCE[d.away.kind].bg, color: ABSENCE[d.away.kind].fg }}>{ABSENCE[d.away.kind].label}</span>}
                    <div className="num" style={{ fontSize: 15 }}>{d.hours}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ================= El equipo hoy ================= */}
        <div className="col">

          <h2>Quién trabaja contigo hoy</h2>
          <DaySlots rows={team} me={profile.id} colorById={colorById} nameById={nameById} absences={[]} />
        </div>
      </div>

      {!autoCode && fichar}
    </>
  );
}

type SB = Awaited<ReturnType<typeof requireProfile>>['sb'];

/** Bloque solo para admins: quién no ha fichado, cosas por revisar y tareas de hoy. */
async function OwnerToday({ sb, today, absences, notices, nameById }: {
  sb: SB; today: string; absences: { user_id: string }[];
  notices: Awaited<ReturnType<typeof loadNotices>>; nameById: Map<string, string>;
}) {
  const { from, to } = dayRange(today);
  const startDay = await getPayStartDay(sb);
  const prevMonth = shiftMonth(payMonthOf(today, startDay), -1);

  const [{ data: bal }, corr, orphans, { data: closings }, { data: people }] = await Promise.all([
    sb.from('shift_balance').select('shift_id, user_id, starts_at, ends_at, real_in').gte('starts_at', from).lt('starts_at', to),
    sb.from('corrections').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('punches').select('id', { count: 'exact', head: true }).is('shift_id', null).is('voided_at', null)
      .gte('at', new Date(Date.now() - 62 * 86400e3).toISOString()),
    sb.from('pay_closings').select('user_id, worker_status').eq('period_month', `${prevMonth}-01`),
    sb.from('profiles').select('id').eq('active', true).eq('role', 'worker'),
  ]);

  const now = Date.now();
  const absentIds = new Set(absences.map((a) => a.user_id));
  const missing = ((bal ?? []) as { shift_id: string; user_id: string; starts_at: string; ends_at: string; real_in: string | null }[])
    .filter((b) => !b.real_in && new Date(b.starts_at).getTime() <= now && !absentIds.has(b.user_id))
    .map((b) => ({ ...b, late: Math.floor((now - new Date(b.starts_at).getTime()) / 60000), ended: new Date(b.ends_at).getTime() < now }));

  const closed = (closings ?? []) as { user_id: string; worker_status: string }[];
  const unclosed = Math.max(0, (people ?? []).length - closed.length);
  const disagree = closed.filter((c) => c.worker_status === 'disagree').length;
  const review = [
    { n: corr.count ?? 0, label: 'correcciones de fichaje pendientes', href: '/admin' },
    { n: orphans.count ?? 0, label: 'fichajes sin turno', href: '/admin' },
    { n: disagree, label: 'nóminas marcadas como “no conforme”', href: `/admin?m=${prevMonth}` },
    { n: unclosed, label: 'nóminas del mes pasado sin cerrar', href: `/admin?m=${prevMonth}` },
  ].filter((r) => r.n > 0);

  const tasks = notices.filter((n) => n.kind === 'tarea');

  return (
    <>
      {missing.length > 0 && (
        <div className="card" style={{ background: 'var(--terracota-bg)', gap: 8 }} role="status">
          <div className="eyebrow" style={{ color: 'var(--terracota)' }}>Sin fichar</div>
          {missing.map((m) => (
            <div key={m.shift_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 15 }}>
              <span style={{ fontWeight: 700 }}>{nameById.get(m.user_id) ?? '—'}</span>
              <span className="small" style={{ color: 'var(--terracota)' }}>
                turno {fmtTime(m.starts_at)}–{fmtTime(m.ends_at)} · {m.ended ? 'no fichó' : `lleva ${m.late >= 60 ? fmtHours(m.late) : `${m.late} min`}`}
              </span>
            </div>
          ))}
        </div>
      )}

      <h2>Por revisar</h2>
      {review.length === 0 ? (
        <div className="card"><div className="muted small">Todo al día.</div></div>
      ) : (
        <div className="list">
          {review.map((r) => (
            <Link key={r.label} href={r.href} className="row" style={{ textDecoration: 'none', color: 'var(--tinta)' }}>
              <span><b>{r.n}</b> {r.label}</span>
              <span aria-hidden="true">›</span>
            </Link>
          ))}
        </div>
      )}

      <h2>Tareas de hoy</h2>
      {tasks.length > 0 && (
        <div className="small muted" style={{ marginTop: -6 }}>{tasks.filter((t) => t.done_at).length} de {tasks.length} hechas</div>
      )}
      <NoticeList notices={tasks} nameById={nameById} owner empty="No hay tareas para hoy. Se ponen desde Turnos y calendario." />
    </>
  );
}
