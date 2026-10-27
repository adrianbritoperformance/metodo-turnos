import Link from 'next/link';
import { requireProfile } from '@/lib/supabase';
import { fmtDay, fmtMinutes, fmtTime, monthName, monthRange, shiftMonth, ymd } from '@/lib/time';
import { CorrectionForm } from '../Forms';

export const dynamic = 'force-dynamic';

type Bal = {
  shift_id: string; starts_at: string; ends_at: string; label: string | null;
  real_in: string | null; real_out: string | null; extra_minutes: number | null; has_pending_correction: boolean;
};

export default async function Horas({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : ymd().slice(0, 7);
  const { sb, profile } = await requireProfile();
  const { from, to } = monthRange(month);

  const { data } = await sb.from('shift_balance').select('*')
    .eq('user_id', profile.id).gte('starts_at', from).lt('starts_at', to)
    .order('starts_at', { ascending: false });
  const rows = (data ?? []) as Bal[];
  const past = rows.filter((r) => new Date(r.starts_at).getTime() < Date.now());
  const total = past.reduce((a, r) => a + (r.extra_minutes ?? 0), 0);
  const worked = past.filter((r) => r.real_out).length;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Bolsa de horas</h1>
      </div>
      <div className="btn-row" style={{ alignItems: 'center' }}>
        <Link className="btn ghost sm" href={`/horas?m=${shiftMonth(month, -1)}`} style={{ flex: '0 0 auto' }} aria-label="Mes anterior">‹</Link>
        <div style={{ textAlign: 'center', fontWeight: 700 }}>{monthName(month)}</div>
        <Link className="btn ghost sm" href={`/horas?m=${shiftMonth(month, 1)}`} style={{ flex: '0 0 auto' }} aria-label="Mes siguiente">›</Link>
      </div>

      <div className="card dark">
        <div className="eyebrow">Acumulado del mes</div>
        <div className="big">{fmtMinutes(total)}</div>
        <div className="small" style={{ color: 'var(--crema)' }}>
          {worked} {worked === 1 ? 'turno fichado' : 'turnos fichados'} · solo cuenta lo que sales después de tu hora
        </div>
      </div>

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
