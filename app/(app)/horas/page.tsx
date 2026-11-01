import Link from 'next/link';
import { requireProfile } from '@/lib/supabase';
import { addDays, fmtDay, fmtHours, fmtMinutes, fmtTime, fmtWeek, madridMidnight, mondayOf, TZ, ymd } from '@/lib/time';
import { colorOf } from '@/lib/colors';
import { loadWeekRows, saldoText, type Contract, type WeekRow } from '@/lib/balance';
import type { Bal } from '@/lib/period';
import { CorrectionForm } from '../Forms';

export const dynamic = 'force-dynamic';

const dayTitle = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, weekday: 'long', day: 'numeric' });
const title = (iso: string) => dayTitle.format(new Date(iso)).replace(/^./, (c) => c.toUpperCase()).replace(',', '');
const short = (iso: string | null) => (iso ? fmtTime(iso).replace(/^0/, '') : '—');
const when = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const ACTION: Record<string, string> = {
  created_past: 'Turno añadido después',
  changed: 'Horas cambiadas',
  deleted: 'Turno quitado',
  reassigned_out: 'Turno pasado a otra persona',
  reassigned_in: 'Turno asignado a ti',
  punch_voided: 'Fichaje anulado',
};

/** Saldo acumulado de las semanas ya terminadas (más el saldo inicial, si lo hubiera). */
function closedSaldo(rows: WeekRow[], userId: string, opening: number) {
  return rows.filter((r) => r.user_id === userId && r.closed).reduce((a, r) => a + r.balance_minutes, opening);
}

export default async function Horas({ searchParams }: { searchParams: Promise<{ u?: string; n?: string }> }) {
  const { u, n } = await searchParams;
  const { sb, profile } = await requireProfile();
  const owner = profile.role === 'owner';
  const limit = n === 'todas' ? 520 : 8;

  const [{ data: ctr }, { data: prf }] = await Promise.all([
    sb.rpc('get_contracts'),
    sb.from('profiles').select('id, full_name, color, active, role'),
  ]);
  const all = (ctr ?? []) as Contract[];
  const profs = (prf ?? []) as { id: string; full_name: string; color: string | null; active: boolean; role: string }[];
  const colorById = new Map(profs.map((p, i) => [p.id, colorOf(p.color, i)]));
  const nameOf = new Map(profs.map((x) => [x.id, x.full_name.split(' ')[0]]));
  // Los admins no tienen bolsa: ven la de cada trabajadora.
  const workers = all.filter((x) => x.role === 'worker' && x.active);
  const targetId = owner ? workers.find((w) => w.user_id === u)?.user_id : profile.id;

  const rows = await loadWeekRows(sb, owner ? undefined : profile.id);
  const thisMonday = mondayOf(ymd());

  // ---------- Resumen del equipo (admins) ----------
  const summary = owner && (
    <section aria-label="Saldo del equipo" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2>Saldo del equipo</h2>
      {workers.length === 0 && <div className="card"><div className="muted">Aún no hay trabajadoras activas.</div></div>}
      <div className="list">
        {workers.map((w) => {
          const s = closedSaldo(rows, w.user_id, Number(w.opening_minutes ?? 0));
          const cur = rows.find((r) => r.user_id === w.user_id && r.week_start === thisMonday);
          const on = w.user_id === targetId;
          return (
            <Link key={w.user_id} href={`/horas?u=${w.user_id}`} className="row" aria-current={on ? 'page' : undefined}
              style={{ textDecoration: 'none', color: 'var(--tinta)', background: on ? 'var(--mantequilla)' : undefined }}>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 99, background: colorById.get(w.user_id), flexShrink: 0 }} />
                <span>
                  <span className="t" style={{ display: 'block' }}>{w.full_name}</span>
                  <span className="small muted">
                    {Number(w.weekly_hours)} h/semana{cur ? ` · esta semana ${fmtHours(cur.worked_minutes)}` : ''}
                  </span>
                </span>
              </span>
              <span style={{ textAlign: 'right' }}>
                <span className={`pill ${Math.abs(s) < 1 ? 'ok' : s > 0 ? 'low' : 'out'}`}>{saldoText(s)}</span>
              </span>
            </Link>
          );
        })}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Saldo de las semanas ya terminadas. “Se le deben” = ha hecho más horas que su contrato; “debe” = menos.
        Se compensa poniéndole menos (o más) horas en el horario de la semana siguiente.
      </p>
    </section>
  );

  if (owner && !targetId) {
    return (
      <>
        <h1>Bolsa de horas</h1>
        <div className="cols">
          <div className="col">{summary}</div>
          <div className="col"><div className="card"><div className="muted">Elige una persona para ver sus semanas y sus fichajes.</div></div></div>
        </div>
      </>
    );
  }

  const me = all.find((c) => c.user_id === targetId);
  const self = targetId === profile.id;
  const opening = Number(me?.opening_minutes ?? 0);
  const mine = rows.filter((r) => r.user_id === targetId);
  const saldo = closedSaldo(rows, targetId!, opening);
  const current = mine.find((r) => r.week_start === thisMonday);

  // Saldo acumulado al acabar cada semana
  let run = opening;
  const withRun = mine.map((r) => { run += r.balance_minutes; return { ...r, after: run }; });
  const shown = [...withRun].reverse().slice(0, limit);
  const oldest = shown.at(-1)?.week_start ?? thisMonday;
  const newest = shown[0]?.week_start ?? thisMonday;

  const [{ data: bal }, { data: changes }] = await Promise.all([
    sb.from('shift_balance').select('*').eq('user_id', targetId!)
      .gte('starts_at', madridMidnight(oldest).toISOString()).lt('starts_at', madridMidnight(addDays(newest, 7)).toISOString())
      .order('starts_at'),
    sb.from('shift_changes').select('id, action, old_starts, old_ends, new_starts, new_ends, at, changed_by, reason')
      .eq('user_id', targetId!).order('at', { ascending: false }).limit(15),
  ]);
  const shifts = (bal ?? []) as Bal[];
  const now = Date.now();
  const pastShifts = shifts.filter((s) => new Date(s.starts_at).getTime() < now).slice(-40);
  const s1 = self ? 'Se te deben' : 'Se le deben';
  const s2 = self ? 'Debes' : 'Debe';

  return (
    <>
      <h1>{owner ? 'Bolsa de horas' : 'Horas y bolsa de horas'}</h1>
      <div className="cols">
        <div className="col sticky">
          {summary}
          <div className="card dark" style={{ gap: 8 }}>
            <div className="eyebrow">{owner ? me?.full_name : 'Tu saldo'} · hasta la semana pasada</div>
            <div className="big" style={{ fontSize: 34 }}>{Math.abs(saldo) < 1 ? 'Al día' : `${saldo > 0 ? s1 : s2} ${fmtHours(saldo)}`}</div>
            {current && (
              <div className="small" style={{ color: 'var(--crema)' }}>
                Esta semana: {fmtHours(current.worked_minutes)} de {fmtHours(current.contract_minutes)} ({fmtMinutes(current.balance_minutes)}).
                {' '}Si se cumple el horario, al acabar: {saldoText(saldo + current.balance_minutes)}.
              </div>
            )}
            <div className="small" style={{ color: 'var(--crema)' }}>Contrato: {Number(me?.weekly_hours ?? 0)} h/semana</div>
          </div>
          <a className="btn soft" href={`/horas/export?m=${ymd().slice(0, 7)}${self ? '' : `&u=${targetId}`}`}>
            Descargar horas trabajadas de este mes (Excel)
          </a>
          <p className="small muted" style={{ margin: 0 }}>
            Horas hechas = las de los turnos + lo que se sale después de la hora de fin (entrar antes no suma).
            Cada semana se compara con el contrato. Las semanas sin turnos (vacaciones) no cuentan.
          </p>
        </div>

        <div className="col">
          <h2>Semana a semana</h2>
          {shown.length === 0 && <div className="card"><div className="muted">Aún no hay semanas con turnos.</div></div>}
          {shown.map((w) => {
            const future = w.week_start > thisMonday;
            const open = !w.closed;
            const days = new Map<string, Bal[]>();
            for (const s of shifts.filter((x) => mondayOf(ymd(x.starts_at)) === w.week_start)) {
              days.set(ymd(s.starts_at), [...(days.get(ymd(s.starts_at)) ?? []), s]);
            }
            return (
              <details key={w.week_start} className="list" open={w.week_start === thisMonday}>
                <summary className="row" style={{ background: open ? 'var(--mantequilla)' : 'var(--papel)', cursor: 'pointer' }}>
                  <div>
                    <div className="eyebrow">Semana {fmtWeek(w.week_start)}{future ? ' · prevista' : open ? ' · en curso' : ''}</div>
                    <div className="small" style={{ marginTop: 2 }}>
                      {fmtHours(w.worked_minutes)} de {fmtHours(w.contract_minutes)}
                      {w.extra_minutes > 0 ? ` · ${w.extra_minutes} min de más al salir` : ''}
                    </div>
                    <div className="small muted">Saldo al acabar: {saldoText(w.after)}</div>
                  </div>
                  <div className="num" style={{ color: w.balance_minutes < 0 ? 'var(--terracota)' : undefined }}>{fmtMinutes(w.balance_minutes)}</div>
                </summary>
                {[...days.entries()].map(([day, list]) => {
                  const fut = new Date(list[0].starts_at).getTime() > now;
                  const base = list.reduce((a, s) => a + s.planned_minutes, 0);
                  const extra = list.reduce((a, s) => a + (s.extra_minutes ?? 0), 0);
                  const missing = list.some((s) => !s.real_out && new Date(s.ends_at).getTime() < now && !s.has_pending_correction);
                  return (
                    <div key={day} className="row" style={{ alignItems: 'flex-start', opacity: fut ? 0.6 : 1 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                        <div className="t">{title(list[0].starts_at)}</div>
                        <div className="muted small">
                          {fut
                            ? `Previsto ${list.map((x) => `${short(x.starts_at)}–${short(x.ends_at)}`).join(' / ')}`
                            : `Turno ${list.map((x) => `${short(x.starts_at)}–${short(x.ends_at)}`).join(' / ')} · fichado ${list.map((x) => `${short(x.real_in)}–${short(x.real_out)}`).join(' / ')}`}
                        </div>
                        {list.some((s) => s.has_pending_correction) && <span className="pill out" style={{ alignSelf: 'flex-start' }}>Corrección pendiente</span>}
                        {missing && <span className="pill low" style={{ alignSelf: 'flex-start' }}>Falta fichar salida</span>}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        {extra > 0 && <div className="small" style={{ fontWeight: 700, color: 'var(--espresso)' }}>+{extra}′</div>}
                        <div className="num" style={{ fontSize: 16 }}>{fmtHours(base + extra)}</div>
                      </div>
                    </div>
                  );
                })}
              </details>
            );
          })}
          {mine.length > shown.length && (
            <Link className="btn ghost sm" href={`/horas?n=todas${owner ? `&u=${targetId}` : ''}`}>Ver todas las semanas</Link>
          )}

          {self && pastShifts.length > 0 && (
            <details className="card">
              <summary className="btn ghost">¿Se te olvidó fichar? Pedir corrección</summary>
              <div style={{ marginTop: 12 }}>
                <CorrectionForm shifts={[...pastShifts].reverse().map((r) => ({ id: r.shift_id, label: `${fmtDay(r.starts_at)} · ${fmtTime(r.starts_at)}–${fmtTime(r.ends_at)}` }))} />
              </div>
            </details>
          )}

          <h2>{self ? 'Cambios en tus turnos' : 'Cambios en sus turnos'}</h2>
          {(changes ?? []).length === 0 ? (
            <div className="card"><div className="muted small">Ningún cambio en turnos ya publicados.</div></div>
          ) : (
            <div className="list">
              {((changes ?? []) as { id: string; action: string; old_starts: string | null; old_ends: string | null; new_starts: string | null; new_ends: string | null; at: string; changed_by: string | null; reason: string | null }[]).map((h) => (
                <div key={h.id} className="row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div className="t">{ACTION[h.action] ?? h.action}</div>
                    <div className="small">
                      {fmtDay((h.old_starts ?? h.new_starts)!)}
                      {h.action === 'punch_voided'
                        ? ` · ${h.reason?.split(' · ')[0] ?? ''} ${short(h.old_starts)}${h.reason?.includes(' · ') ? ` · motivo: ${h.reason.split(' · ').slice(1).join(' · ')}` : ''}`
                        : <>
                            {h.old_starts && ` · antes ${short(h.old_starts)}–${short(h.old_ends)}`}
                            {h.new_starts && ` · ${h.old_starts ? 'ahora ' : ''}${short(h.new_starts)}–${short(h.new_ends)}`}
                          </>}
                    </div>
                    <div className="small muted">{when.format(new Date(h.at))}{h.changed_by ? ` · por ${nameOf.get(h.changed_by) ?? '—'}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
