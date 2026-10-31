import Link from 'next/link';
import { requireProfile } from '@/lib/supabase';
import { getPayStartDay, loadPeriod } from '@/lib/period';
import {
  fmtDay, fmtHours, fmtMinutes, fmtRange, fmtTime, fmtWeek, monthOnly, payMonthOf, shiftMonth, TZ, ymd,
} from '@/lib/time';
import { CorrectionForm, RespondClosingForm } from '../Forms';

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

export default async function Horas({ searchParams }: { searchParams: Promise<{ m?: string; u?: string }> }) {
  const { m, u } = await searchParams;
  const { sb, profile } = await requireProfile();
  const startDay = await getPayStartDay(sb);
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : payMonthOf(ymd(), startDay);

  const owner = profile.role === 'owner';
  const { data: contracts } = await sb.rpc('get_contracts');
  type C = { user_id: string; full_name: string; role: string; active: boolean; weekly_hours: number; opening_minutes: number; opening_note: string | null };
  const all = (contracts ?? []) as C[];
  // Admins: ven la bolsa de cada trabajadora (no tienen horas propias).
  const workers = all.filter((x) => x.role === 'worker' && x.active);
  const targetId = owner ? (workers.find((w) => w.user_id === u)?.user_id ?? workers[0]?.user_id) : profile.id;
  const self = targetId === profile.id;
  const qs = (mm: string) => `/horas?m=${mm}${owner && targetId ? `&u=${targetId}` : ''}`;
  if (owner && !targetId) {
    return (
      <>
        <h1>Bolsa de horas</h1>
        <div className="card"><div className="muted">Aún no hay trabajadoras activas en el equipo.</div></div>
      </>
    );
  }
  const me = all.find((c) => c.user_id === targetId);
  const weekly = Number(me?.weekly_hours ?? 0);

  const [p, { data: changes }, { data: managers }] = await Promise.all([
    loadPeriod(sb, targetId!, month, startDay, weekly, me?.opening_minutes ?? 0),
    sb.from('shift_changes').select('id, action, old_starts, old_ends, new_starts, new_ends, at, changed_by, reason')
      .eq('user_id', targetId!).order('at', { ascending: false }).limit(15),
    sb.from('profiles').select('id, full_name'),
  ]);
  const nameOf = new Map(((managers ?? []) as { id: string; full_name: string }[]).map((x) => [x.id, x.full_name.split(' ')[0]]));
  const total = p.carriedIn + p.balance;
  const c = p.closing;

  return (
    <>
      <h1>{owner ? 'Bolsa de horas' : 'Horas y bolsa de horas'}</h1>
      {owner && (
        <nav aria-label="Trabajadoras" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {workers.map((w) => (
            <Link key={w.user_id} href={`/horas?m=${month}&u=${w.user_id}`} aria-current={w.user_id === targetId ? 'page' : undefined}
              className={w.user_id === targetId ? 'btn sm' : 'btn ghost sm'}>
              {w.full_name.split(' ')[0]}
            </Link>
          ))}
        </nav>
      )}
      {owner && <div className="small muted" style={{ marginTop: -4 }}>Viendo la bolsa de <b>{me?.full_name}</b> · contrato {weekly} h/semana</div>}
      <div className="btn-row" style={{ alignItems: 'center' }}>
        <Link className="btn ghost sm" href={qs(shiftMonth(month, -1))} style={{ flex: '0 0 auto' }} aria-label="Nómina anterior">‹</Link>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 700 }}>Nómina de {monthOnly(month)}</div>
          <div className="small muted">{fmtRange(p.start, p.end)}</div>
        </div>
        <Link className="btn ghost sm" href={qs(shiftMonth(month, 1))} style={{ flex: '0 0 auto' }} aria-label="Nómina siguiente">›</Link>
      </div>

      <div className="cols">
      <div className="col sticky">
      {/* ---- Resumen del periodo ---- */}
      <div className="card dark" style={{ gap: 10 }}>
        <div className="eyebrow">{c ? 'Cierre de la nómina' : p.finished ? 'Periodo terminado · pendiente de cierre' : 'Periodo en curso'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 15 }}>
          <Line label="Venía de antes" value={fmtMinutes(p.carriedIn)} />
          <Line label={`Este periodo (${fmtHours(p.worked)} de ${fmtHours(p.contract)})`} value={fmtMinutes(c ? c.balance_minutes : p.balance)} />
          {c && <Line label="Pagadas en nómina" value={`−${fmtHours(c.paid_minutes)}`} />}
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,.25)', paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span>{c ? 'Queda para compensar' : 'Total acumulado'}</span>
          <span className="big" style={{ fontSize: 32 }}>{fmtMinutes(c ? c.carried_out : total)}</span>
        </div>
        {!c && !p.finished && <div className="small" style={{ color: 'var(--crema)' }}>Provisional: incluye los turnos que ya tienes puestos hasta el {Number(p.end.slice(8))}.</div>}
        {c?.note && <div className="small" style={{ color: 'var(--crema)' }}>Nota de la encargada: {c.note}</div>}
      </div>

      {c && self && <RespondClosingForm id={c.id} status={c.worker_status} comment={c.worker_comment} />}
      {c && !self && (
        <div className="card">
          <span className={`pill ${c.worker_status === 'agree' ? 'ok' : c.worker_status === 'disagree' ? 'out' : 'low'}`} style={{ alignSelf: 'flex-start' }}>
            {c.worker_status === 'agree' ? 'Conforme' : c.worker_status === 'disagree' ? 'No conforme' : 'Pendiente de respuesta'}
          </span>
          {c.worker_comment && <div className="small">“{c.worker_comment}”</div>}
        </div>
      )}

      {me && me.opening_minutes !== 0 && (
        <div className="card">
          <div className="eyebrow">Saldo inicial</div>
          <div style={{ fontSize: 15 }}>{self ? 'Empezaste' : 'Empezó'} con <b>{fmtMinutes(me.opening_minutes)}</b>{me.opening_note ? ` — ${me.opening_note}` : ''}.</div>
        </div>
      )}

      <a className="btn soft" href={`/horas/export?m=${month}${self ? '' : `&u=${targetId}`}`}>{self ? 'Descargar mi registro (Excel)' : `Descargar registro de ${me?.full_name.split(' ')[0]} (Excel)`}</a>
      </div>
      <div className="col">
      {/* ---- Desglose por semanas y días ---- */}
      {p.weeks.length === 0 && <div className="card"><div className="muted">Aún no hay turnos en este periodo.</div></div>}
      {p.weeks.map((w) => {
        const diff = w.worked - w.contract;
        return (
          <section key={w.monday} className="list" aria-label={`Semana ${fmtWeek(w.monday)}`}>
            <div className="row" style={{ background: w.open ? 'var(--mantequilla)' : 'var(--papel)', borderBottom: '2px solid var(--linea)' }}>
              <div>
                <div className="eyebrow">Semana {fmtWeek(w.monday)}{w.open ? ' · en curso' : ''}</div>
                <div className="small" style={{ marginTop: 2 }}>{fmtHours(w.worked)} de {fmtHours(w.contract)}</div>
              </div>
              <div className="num" style={{ color: diff < 0 ? 'var(--terracota)' : undefined }}>{fmtMinutes(diff)}</div>
            </div>
            {w.days.map((d) => (
              <div key={d.day} className="row" style={{ alignItems: 'flex-start', opacity: d.future ? 0.6 : 1 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  <div className="t">{title(d.list[0].starts_at)}</div>
                  <div className="muted small">
                    {d.future
                      ? `Previsto ${d.list.map((x) => `${short(x.starts_at)}–${short(x.ends_at)}`).join(' / ')}`
                      : `Fichado ${d.list.map((x) => `${short(x.real_in)}–${short(x.real_out)}`).join(' / ')}`}
                  </div>
                  {d.pending && <span className="pill out" style={{ alignSelf: 'flex-start' }}>Corrección pendiente</span>}
                  {d.missing && <span className="pill low" style={{ alignSelf: 'flex-start' }}>Falta fichar salida</span>}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div className="small muted">base {fmtHours(d.base)}</div>
                  {d.extra > 0 && <div className="small" style={{ fontWeight: 700, color: 'var(--espresso)' }}>+{d.extra}′</div>}
                  <div className="num" style={{ fontSize: 16 }}>{fmtHours(d.base + d.extra)}</div>
                </div>
              </div>
            ))}
          </section>
        );
      })}

      <p className="small muted" style={{ margin: 0 }}>
        Base = las horas de tus turnos. Se suma lo que salgas después de tu hora; entrar antes no cuenta.
        {self ? 'Tu' : 'Su'} contrato ({weekly} h/semana) se reparte por días en las semanas que caen entre dos nóminas.
      </p>

      {self && p.pastShifts.length > 0 && (
        <details className="card">
          <summary className="btn ghost">¿Se te olvidó fichar? Pedir corrección</summary>
          <div style={{ marginTop: 12 }}>
            <CorrectionForm shifts={[...p.pastShifts].reverse().map((r) => ({ id: r.shift_id, label: `${fmtDay(r.starts_at)} · ${fmtTime(r.starts_at)}–${fmtTime(r.ends_at)}` }))} />
          </div>
        </details>
      )}

      {/* ---- Historial ---- */}
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

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--crema)' }}>{label}</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );
}
