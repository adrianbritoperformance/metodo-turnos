import Link from 'next/link';
import { requireProfile } from '@/lib/supabase';
import { fmtDay, fmtHours, fmtMinutes, fmtTime, fmtWeek, monthName, monthRange, shiftMonth, ymd } from '@/lib/time';
import { CorrectionForm } from '../Forms';

export const dynamic = 'force-dynamic';

type Bal = {
  shift_id: string; starts_at: string; ends_at: string; label: string | null;
  real_in: string | null; real_out: string | null; extra_minutes: number | null; has_pending_correction: boolean;
};
type Week = {
  week_start: string; shifts: number; worked_minutes: number; contract_minutes: number;
  balance_minutes: number; extra_minutes: number; has_missing_out: boolean; closed: boolean;
};

export default async function Horas({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : ymd().slice(0, 7);
  const { sb, profile } = await requireProfile();
  const { from, to } = monthRange(month);

  const [{ data }, { data: wk }, { data: contract }] = await Promise.all([
    sb.from('shift_balance').select('*')
      .eq('user_id', profile.id).gte('starts_at', from).lt('starts_at', to)
      .order('starts_at', { ascending: false }),
    sb.from('week_balance').select('*')
      .eq('user_id', profile.id).gte('week_start', `${month}-01`).lt('week_start', `${shiftMonth(month, 1)}-01`)
      .order('week_start', { ascending: false }),
    sb.rpc('get_contracts'),
  ]);
  const rows = (data ?? []) as Bal[];
  const weeks = (wk ?? []) as Week[];
  const weekly = Number((contract as { user_id: string; weekly_hours: number }[] | null)?.find((c) => c.user_id === profile.id)?.weekly_hours ?? 0);
  const past = rows.filter((r) => new Date(r.starts_at).getTime() < Date.now());
  const closed = weeks.filter((w) => w.closed);
  const open = weeks.find((w) => !w.closed);
  const total = closed.reduce((a, w) => a + w.balance_minutes, 0);

  return (
    <>
      <h1>Bolsa de horas</h1>
      <div className="btn-row" style={{ alignItems: 'center' }}>
        <Link className="btn ghost sm" href={`/horas?m=${shiftMonth(month, -1)}`} style={{ flex: '0 0 auto' }} aria-label="Mes anterior">‹</Link>
        <div style={{ textAlign: 'center', fontWeight: 700 }}>{monthName(month)}</div>
        <Link className="btn ghost sm" href={`/horas?m=${shiftMonth(month, 1)}`} style={{ flex: '0 0 auto' }} aria-label="Mes siguiente">›</Link>
      </div>

      <div className="card dark">
        <div className="eyebrow">Saldo del mes</div>
        <div className="big">{fmtMinutes(total)}</div>
        <div className="small" style={{ color: 'var(--crema)' }}>
          Contrato: {weekly} h/semana · {closed.length} {closed.length === 1 ? 'semana cerrada' : 'semanas cerradas'}
        </div>
      </div>

      {open && (
        <div className="card yellow">
          <div className="eyebrow">Esta semana · {fmtWeek(open.week_start)}</div>
          <div className="big" style={{ fontSize: 24 }}>{fmtHours(open.worked_minutes)} de {fmtHours(open.contract_minutes)}</div>
          <div className="muted small">Cuenta lo previsto en tus turnos + lo que salgas tarde. Se suma al saldo cuando acabe la semana.</div>
        </div>
      )}

      {closed.length > 0 && (
        <>
          <h2>Semanas</h2>
          <div className="list">
            {closed.map((w) => (
              <div key={w.week_start} className="row">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div className="t">{fmtWeek(w.week_start)}</div>
                  <div className="muted small">
                    {fmtHours(w.worked_minutes)} de {fmtHours(w.contract_minutes)}
                    {w.extra_minutes > 0 ? ` · ${w.extra_minutes}′ por salir tarde` : ''}
                  </div>
                  {w.has_missing_out && <span className="pill low" style={{ alignSelf: 'flex-start' }}>Falta fichar alguna salida</span>}
                </div>
                <div className="num" style={{ color: w.balance_minutes < 0 ? 'var(--terracota)' : undefined }}>{fmtMinutes(w.balance_minutes)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>Turnos</h2>
      {past.length > 0 ? (
        <div className="list">
          {past.map((r) => (
            <div key={r.shift_id} className="row">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div className="t">{fmtDay(r.starts_at)}{r.label ? ` · ${r.label}` : ''}</div>
                <div className="muted small">
                  Turno {fmtTime(r.starts_at)}–{fmtTime(r.ends_at)} · Real {fmtTime(r.real_in)}–{fmtTime(r.real_out)}
                </div>
                {r.has_pending_correction && <span className="pill out" style={{ alignSelf: 'flex-start' }}>Corrección pendiente</span>}
                {!r.real_out && !r.has_pending_correction && <span className="pill low" style={{ alignSelf: 'flex-start' }}>Falta fichar salida</span>}
              </div>
              <div className="num">{r.extra_minutes === null ? '—' : r.extra_minutes > 0 ? `+${r.extra_minutes}′` : '0′'}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card"><div className="muted">Aún no hay turnos este mes.</div></div>
      )}

      {past.length > 0 && (
        <details className="card">
          <summary className="btn ghost">¿Se te olvidó fichar? Pedir corrección</summary>
          <div style={{ marginTop: 12 }}>
            <CorrectionForm shifts={past.map((r) => ({ id: r.shift_id, label: `${fmtDay(r.starts_at)} · ${fmtTime(r.starts_at)}–${fmtTime(r.ends_at)}` }))} />
          </div>
        </details>
      )}
    </>
  );
}
