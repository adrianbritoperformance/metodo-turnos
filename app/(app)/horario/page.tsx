import Link from 'next/link';
import { requireProfile } from '@/lib/supabase';
import { addDays, fmtHours, fmtWeek, madridAt, madridMidnight, mondayOf, shortTime, TZ, ymd } from '@/lib/time';
import { colorOf } from '@/lib/colors';
import { ABSENCE, absentOn, loadAbsences } from '@/lib/absences';
import { loadWeekRows, saldoBefore, saldoText, type Contract } from '@/lib/balance';
import { copyWeek } from '../actions';
import { HorarioGrid, type GridDay, type GridPerson } from './HorarioGrid';

export const dynamic = 'force-dynamic';

const dayName = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', timeZone: 'UTC' });
const label = (d: string) => dayName.format(new Date(`${d}T12:00:00Z`)).replace(/^./, (c) => c.toUpperCase()).replace(',', '');
const hm = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const t = (ms: number) => hm.format(new Date(ms)).replace(/^0/, '');

type Block = { id: string; weekdays: number[]; start_time: string; end_time: string };
type Prof = { id: string; full_name: string; color: string | null; active: boolean; role: string; job_title: string | null };
type Shift = { id: string; user_id: string; starts_at: string; ends_at: string };

/** Horario por franjas, como la tabla de Word: días en filas, franjas en columnas, nombres dentro. */
export default async function Horario({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const { w } = await searchParams;
  const { sb, profile } = await requireProfile();
  const owner = profile.role === 'owner';
  const monday = w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? mondayOf(w) : mondayOf(ymd());
  const sunday = addDays(monday, 6);

  const [{ data: blk }, { data: prf }, { data: sh }, absences, contracts, weekRows] = await Promise.all([
    sb.from('day_blocks').select('id, weekdays, start_time, end_time').order('start_time'),
    sb.from('profiles').select('id, full_name, color, active, role, job_title').order('full_name'),
    sb.from('shifts').select('id, user_id, starts_at, ends_at')
      .gte('starts_at', madridMidnight(monday).toISOString()).lt('starts_at', madridMidnight(addDays(monday, 7)).toISOString())
      .order('starts_at'),
    loadAbsences(sb, monday, sunday),
    owner ? sb.rpc('get_contracts').then((r) => (r.data ?? []) as Contract[]) : Promise.resolve([] as Contract[]),
    owner ? loadWeekRows(sb) : Promise.resolve([]),
  ]);

  const blocks = (blk ?? []) as Block[];
  const shifts = (sh ?? []) as Shift[];
  const active = ((prf ?? []) as Prof[]).filter((p) => p.active);
  // Primero el equipo y después los dueños, cada grupo por orden alfabético.
  const ordered = [...active.filter((p) => p.role !== 'owner'), ...active.filter((p) => p.role === 'owner')];
  const colorById = new Map(ordered.map((p, i) => [p.id, colorOf(p.color, i)]));
  const nameById = new Map(ordered.map((p) => [p.id, p.full_name.split(' ')[0]]));

  const days: GridDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const iso = i + 1;
    const dayShifts = shifts.filter((s) => ymd(s.starts_at) === date && nameById.has(s.user_id));
    const used = new Set<string>();
    const cells = blocks.filter((b) => b.weekdays.includes(iso)).map((b) => {
      const bs = madridAt(date, b.start_time).getTime();
      const be = madridAt(date, b.end_time).getTime();
      const people: { id: string; note?: string }[] = [];
      for (const p of ordered) {
        const hit = dayShifts.filter((s) => s.user_id === p.id && new Date(s.starts_at).getTime() < be && new Date(s.ends_at).getTime() > bs);
        if (!hit.length) continue;
        hit.forEach((s) => used.add(s.id));
        const st = Math.min(...hit.map((s) => new Date(s.starts_at).getTime()));
        const en = Math.max(...hit.map((s) => new Date(s.ends_at).getTime()));
        const note = st > bs && en < be ? `${t(st)}–${t(en)}` : st > bs ? `desde ${t(st)}` : en < be ? `hasta ${t(en)}` : undefined;
        people.push({ id: p.id, note });
      }
      return { blockId: b.id, start: shortTime(b.start_time), end: shortTime(b.end_time), people };
    });
    // Turnos que no caen en ninguna franja (por ejemplo, de antes de cambiar el horario): se enseñan aparte.
    const outside = dayShifts.filter((s) => !used.has(s.id)).map((s) => ({
      id: s.user_id, note: `${t(new Date(s.starts_at).getTime())}–${t(new Date(s.ends_at).getTime())}`,
    }));
    const away = absentOn(absences, date).filter((a) => nameById.has(a.user_id))
      .map((a) => ({ id: a.user_id, label: ABSENCE[a.kind].label }));
    return { date, label: label(date), cells, outside, away, today: date === ymd() };
  });

  const contractOf = new Map(contracts.map((c) => [c.user_id, c]));
  const people: GridPerson[] = ordered.map((p) => {
    const mine = shifts.filter((s) => s.user_id === p.id);
    const planned = Math.round(mine.reduce((a, s) => a + (new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000, 0));
    const c = contractOf.get(p.id);
    const isWorker = p.role !== 'owner';
    const before = owner && isWorker ? saldoBefore(weekRows, p.id, monday, Number(c?.opening_minutes ?? 0)) : 0;
    const row = weekRows.find((r) => r.user_id === p.id && r.week_start === monday);
    return {
      id: p.id, name: p.full_name.split(' ')[0], fullName: p.full_name, color: colorById.get(p.id)!,
      owner: !isWorker, job: p.job_title,
      planned, contract: isWorker && c ? Math.round(Number(c.weekly_hours) * 60) : null,
      before: owner && isWorker ? before : null,
      after: owner && isWorker ? before + (row?.balance_minutes ?? 0) : null,
    };
  });

  const nav = (d: string) => `/horario?w=${d}`;
  const thisMonday = mondayOf(ymd());
  const workers = people.filter((p) => !p.owner);

  return (
    <>
      <h1>Horario</h1>
      <div className="btn-row" style={{ alignItems: 'center' }}>
        <Link className="btn ghost sm" href={nav(addDays(monday, -7))} style={{ flex: '0 0 auto' }} aria-label="Semana anterior">‹</Link>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 700 }}>Semana {fmtWeek(monday)}</div>
          {monday !== thisMonday && <Link className="small" href="/horario">Ir a esta semana</Link>}
          {monday === thisMonday && <div className="small muted">Esta semana</div>}
        </div>
        <Link className="btn ghost sm" href={nav(addDays(monday, 7))} style={{ flex: '0 0 auto' }} aria-label="Semana siguiente">›</Link>
      </div>

      {blocks.length === 0 && (
        <div className="card"><div className="muted">
          Aún no hay franjas. {owner ? 'Créalas en Gestión → Franjas del horario.' : 'Las pondrán los admins.'}
        </div></div>
      )}

      {blocks.length > 0 && (
        <HorarioGrid days={days} people={people} owner={owner} me={profile.id} />
      )}

      {owner && blocks.length > 0 && (
        <div className="cols">
          <div className="col">
            <h2>Horas del equipo esta semana</h2>
            <div className="list">
              {workers.map((p) => {
                const diff = p.contract === null || p.planned === 0 ? 0 : p.planned - p.contract;
                return (
                  <div key={p.id} className="row" style={{ alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 99, background: p.color, marginTop: 5, flexShrink: 0 }} />
                      <div>
                        <div className="t">{p.fullName}</div>
                        <div className="small muted">Antes de esta semana: <b>{saldoText(p.before ?? 0)}</b></div>
                        {p.planned > 0 && <div className="small muted">Al acabar la semana: <b>{saldoText(p.after ?? 0)}</b></div>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div className="num" style={{ fontSize: 16 }}>{fmtHours(p.planned)}<span className="small muted"> / {fmtHours(p.contract ?? 0)}</span></div>
                      {diff !== 0 && <div className="small" style={{ fontWeight: 700, color: diff > 0 ? 'var(--espresso)' : 'var(--terracota)' }}>{diff > 0 ? '+' : '−'}{fmtHours(diff)}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              “Se le deben” = ha hecho más horas que su contrato; “debe” = ha hecho menos. Para compensar,
              ponle algo menos (o más) la semana que viene. Incluye lo que se quedan de más al fichar la salida.
            </p>
          </div>
          <div className="col">
            <h2>Atajos</h2>
            <form action={copyWeek} className="card" style={{ gap: 8 }}>
              <input type="hidden" name="from" value={monday} />
              <input type="hidden" name="to" value={addDays(monday, 7)} />
              <button className="btn ghost">Copiar esta semana a la siguiente</button>
              <div className="small muted">Copia todos los turnos a la semana del {fmtWeek(addDays(monday, 7))}. No pisa lo que ya esté puesto allí.</div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
