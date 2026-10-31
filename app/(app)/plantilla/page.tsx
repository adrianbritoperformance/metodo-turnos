import Link from 'next/link';
import { requireOwner } from '@/lib/supabase';
import { addDays, fmtHours, fmtTime, fmtWeek, madridMidnight, mondayOf, ymd } from '@/lib/time';
import { ABSENCE, absentOn, loadAbsences } from '@/lib/absences';
import { colorOf } from '@/lib/colors';
import { TemplateToggle } from '../turnos/Toggle';
import { ClearWeekForm } from '../Forms';
import { copyWeek } from '../actions';

export const dynamic = 'force-dynamic';

type Tpl = { id: string; name: string; start_time: string; end_time: string; weekdays: number[] };
type Shift = { id: string; user_id: string; starts_at: string; ends_at: string; template_id: string | null };

const WD = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const dm = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const dayLabel = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return dm.format(new Date(Date.UTC(y, m - 1, dd))).replace('.', ''); };

/** Plantilla semanal: cada trabajadora en una fila, cada día una columna con Mañana / Tarde. */
export default async function Plantilla({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const { w } = await searchParams;
  const { sb } = await requireOwner();
  const mon = mondayOf(w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? w : ymd());
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const from = madridMidnight(mon).toISOString();
  const to = madridMidnight(addDays(mon, 7)).toISOString();

  const [{ data: shiftRows }, { data: tpls }, { data: contracts }, { data: profs }, absences] = await Promise.all([
    sb.from('shifts').select('id, user_id, starts_at, ends_at, template_id').gte('starts_at', from).lt('starts_at', to).order('starts_at'),
    sb.from('shift_templates').select('id, name, start_time, end_time, weekdays').order('sort'),
    sb.rpc('get_contracts'),
    sb.from('profiles').select('id, color, active, role').order('full_name'),
    loadAbsences(sb, mon, addDays(mon, 6)),
  ]);
  const shifts = (shiftRows ?? []) as Shift[];
  const templates = (tpls ?? []) as Tpl[];
  const workers = ((contracts ?? []) as { user_id: string; full_name: string; weekly_hours: number; active: boolean; role: string }[])
    .filter((c) => c.active && c.role === 'worker');
  const colorById = new Map(((profs ?? []) as { id: string; color: string | null; active: boolean; role: string }[])
    .filter((p) => p.active && p.role === 'worker').map((p, i) => [p.id, colorOf(p.color, i)]));
  const isoDow = (i: number) => i + 1;
  const today = ymd();

  return (
    <>
      <h1>Plantilla</h1>
      <div className="btn-row" style={{ alignItems: 'center', maxWidth: 640 }}>
        <Link className="btn ghost sm" href={`/plantilla?w=${addDays(mon, -7)}`} style={{ flex: '0 0 auto' }} aria-label="Semana anterior">‹</Link>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 700 }}>Semana {fmtWeek(mon)}</div>
          {mondayOf(today) !== mon && <Link href="/plantilla" className="small">Ir a esta semana</Link>}
        </div>
        <Link className="btn ghost sm" href={`/plantilla?w=${addDays(mon, 7)}`} style={{ flex: '0 0 auto' }} aria-label="Semana siguiente">›</Link>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Toca <b>Mañana</b> o <b>Tarde</b> para poner o quitar el turno con su horario de siempre. Para cambiar horas o poner una tarea, ve a Turnos y calendario.
      </p>

      {workers.length === 0 ? (
        <div className="card"><div className="muted">Aún no hay trabajadoras en el equipo.</div></div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 18, background: 'var(--papel)' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 860 }}>
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: 'left', padding: '12px 14px', position: 'sticky', left: 0, background: 'var(--papel)', zIndex: 1 }} className="eyebrow">Persona</th>
                {days.map((d, i) => (
                  <th key={d} scope="col" style={{ padding: '10px 4px', fontSize: 13, background: d === today ? 'var(--mantequilla)' : undefined }}>
                    <div style={{ fontWeight: 700 }}>{WD[i]}</div>
                    <div className="small muted" style={{ fontWeight: 400 }}>{dayLabel(d)}</div>
                  </th>
                ))}
                <th scope="col" className="eyebrow" style={{ padding: '10px 10px', textAlign: 'right' }}>Semana</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((p) => {
                const mine = shifts.filter((s) => s.user_id === p.user_id);
                const plan = mine.reduce((a, s) => a + (new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000, 0);
                const contract = Number(p.weekly_hours) * 60;
                const diff = plan - contract;
                return (
                  <tr key={p.user_id} style={{ borderTop: '1px solid var(--linea)' }}>
                    <th scope="row" style={{ textAlign: 'left', padding: '8px 14px', position: 'sticky', left: 0, background: 'var(--papel)', zIndex: 1, whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                        <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 99, background: colorById.get(p.user_id) }} />
                        {p.full_name.split(' ')[0]}
                      </span>
                    </th>
                    {days.map((d, i) => {
                      const dayTpls = templates.filter((t) => t.weekdays.includes(isoDow(i)));
                      const dayShifts = mine.filter((s) => ymd(s.starts_at) === d);
                      const away = absentOn(absences, d, p.user_id)[0];
                      const extra = dayShifts.filter((s) => !s.template_id || !dayTpls.some((t) => t.id === s.template_id));
                      return (
                        <td key={d} style={{ padding: 4, verticalAlign: 'top', background: d === today ? '#FBF3D6' : undefined }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {away && (
                              <span className="pill" style={{ background: ABSENCE[away.kind].bg, color: ABSENCE[away.kind].fg, textAlign: 'center' }}>
                                {ABSENCE[away.kind].label}
                              </span>
                            )}
                            {dayTpls.map((t) => {
                              const s = dayShifts.find((x) => x.template_id === t.id);
                              const custom = s && (fmtTime(s.starts_at) !== t.start_time.slice(0, 5) || fmtTime(s.ends_at) !== t.end_time.slice(0, 5))
                                ? `${fmtTime(s.starts_at)}–${fmtTime(s.ends_at)}` : undefined;
                              return (
                                <TemplateToggle key={`${t.id}-${!!s}-${custom ?? ''}`} compact userId={p.user_id} date={d}
                                  templateId={t.id} name={t.name} on={!!s} custom={custom} />
                              );
                            })}
                            {extra.map((s) => (
                              <span key={s.id} className="small" style={{ textAlign: 'center', fontWeight: 700 }}>{fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</span>
                            ))}
                          </div>
                        </td>
                      );
                    })}
                    <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                      <div style={{ fontWeight: 700 }}>{fmtHours(plan)}</div>
                      <div className="small muted">de {fmtHours(contract)}</div>
                      <span className={`pill ${diff === 0 ? 'ok' : diff > 0 ? 'out' : 'low'}`}>
                        {diff === 0 ? 'Justo' : diff > 0 ? `+${fmtHours(diff)}` : `−${fmtHours(diff)}`}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="cols">
        <div className="col">
          <form action={copyWeek} className="card">
            <input type="hidden" name="from" value={addDays(mon, -7)} />
            <input type="hidden" name="to" value={mon} />
            <div className="small muted">Copia la semana {fmtWeek(addDays(mon, -7))} en esta. Lo que ya esté puesto no se duplica.</div>
            <button className="btn soft">Copiar semana anterior</button>
          </form>
        </div>
        <div className="col">
          <ClearWeekForm monday={mon} label={fmtWeek(mon)} />
        </div>
      </div>
    </>
  );
}
