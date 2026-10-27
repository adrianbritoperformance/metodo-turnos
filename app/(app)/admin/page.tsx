import Link from 'next/link';
import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { requireOwner } from '@/lib/supabase';
import { fmtDay, fmtHours, fmtMinutes, fmtTime, monthName, shiftMonth, ymd } from '@/lib/time';
import { reviewCorrection, rotateQr, saveTemplates, setContract, setMember } from '../actions';

export const dynamic = 'force-dynamic';

type Corr = {
  id: string; kind: 'in' | 'out'; requested_at: string; reason: string | null;
  profiles: { full_name: string } | null; shifts: { starts_at: string; ends_at: string } | null;
};

export default async function Admin({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : ymd().slice(0, 7);
  const { sb, profile } = await requireOwner();

  const [{ data: corr }, { data: people }, { data: bal }, { data: codes }, { data: tpls }] = await Promise.all([
    sb.from('corrections').select('id, kind, requested_at, reason, profiles:user_id(full_name), shifts(starts_at, ends_at)')
      .eq('status', 'pending').order('created_at'),
    sb.rpc('get_contracts'),
    sb.from('week_balance').select('user_id, balance_minutes, worked_minutes, contract_minutes, has_missing_out, closed')
      .gte('week_start', `${month}-01`).lt('week_start', `${shiftMonth(month, 1)}-01`),
    sb.rpc('get_admin_codes'),
    sb.from('shift_templates').select('id, name, start_time, end_time').order('sort'),
  ]);
  const templates = (tpls ?? []) as { id: string; name: string; start_time: string; end_time: string }[];

  const pending = (corr ?? []) as unknown as Corr[];
  const team = ((people ?? []) as { user_id: string; full_name: string; weekly_hours: number; role: string; active: boolean }[])
    .map((p) => ({ ...p, id: p.user_id, weekly_hours: Number(p.weekly_hours) }));
  type W = { user_id: string; balance_minutes: number; worked_minutes: number; contract_minutes: number; has_missing_out: boolean; closed: boolean };
  const totals = new Map<string, { balance: number; weeks: number; missing: boolean; now?: W }>();
  for (const w of (bal ?? []) as W[]) {
    const t = totals.get(w.user_id) ?? { balance: 0, weeks: 0, missing: false };
    if (w.closed) { t.balance += w.balance_minutes; t.weeks += 1; t.missing ||= w.has_missing_out; }
    else t.now = w;
    totals.set(w.user_id, t);
  }

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const code = (codes as { qr_secret: string; join_code: string }[] | null)?.[0];
  const qrUrl = code ? `${proto}://${host}/fichar?c=${code.qr_secret}` : '';
  const qrSvg = qrUrl ? await QRCode.toString(qrUrl, { type: 'svg', margin: 1, color: { dark: '#49271A', light: '#FFFFFF' } }) : '';

  return (
    <>
      <h1>Gestión</h1>

      <h2>Correcciones pendientes</h2>
      {pending.length === 0 && <div className="card"><div className="muted">No hay ninguna.</div></div>}
      {pending.map((c) => (
        <div key={c.id} className="card">
          <div style={{ fontWeight: 700 }}>{c.profiles?.full_name}</div>
          <div className="muted">
            {c.shifts ? `${fmtDay(c.shifts.starts_at)} · turno ${fmtTime(c.shifts.starts_at)}–${fmtTime(c.shifts.ends_at)}` : ''}
          </div>
          <div style={{ fontSize: 15 }}>Pide registrar la <b>{c.kind === 'in' ? 'entrada' : 'salida'}</b> a las <b>{fmtTime(c.requested_at)}</b>{c.reason ? ` — “${c.reason}”` : ''}</div>
          <div className="btn-row" style={{ marginTop: 6 }}>
            <form action={reviewCorrection}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="approve" value="1" /><button className="btn sm" style={{ width: '100%' }}>Aprobar</button></form>
            <form action={reviewCorrection}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="approve" value="0" /><button className="btn danger sm" style={{ width: '100%' }}>Rechazar</button></form>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <h2 style={{ margin: 0 }}>Saldo del equipo · {monthName(month)}</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <Link className="btn ghost sm" href={`/admin?m=${shiftMonth(month, -1)}`} aria-label="Mes anterior">‹</Link>
          <Link className="btn ghost sm" href={`/admin?m=${shiftMonth(month, 1)}`} aria-label="Mes siguiente">›</Link>
        </div>
      </div>
      <div className="list">
        {team.map((p) => {
          const t = totals.get(p.id);
          return (
            <details key={p.id} className="row" style={{ display: 'block' }}>
              <summary style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div>
                  <div className="t">{p.full_name}{!p.active ? ' (baja)' : ''}</div>
                  <div className="muted small">
                    {p.role === 'owner' ? 'Encargada · ' : ''}{p.weekly_hours} h/sem · {t?.weeks ?? 0} sem. cerradas
                    {t?.now ? ` · esta semana ${fmtHours(t.now.worked_minutes)}/${fmtHours(t.now.contract_minutes)}` : ''}
                    {t?.missing ? ' · falta alguna salida' : ''}
                  </div>
                </div>
                <div className="num" style={{ color: (t?.balance ?? 0) < 0 ? 'var(--terracota)' : undefined }}>{fmtMinutes(t?.balance ?? 0)}</div>
              </summary>
              <form action={setContract} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10 }}>
                <input type="hidden" name="id" value={p.id} />
                <label style={{ flex: 1 }}>Horas de contrato por semana
                  <input name="weekly_hours" type="number" min={0} max={60} step={0.5} defaultValue={p.weekly_hours} inputMode="decimal" />
                </label>
                <button className="btn sm">Guardar</button>
              </form>
              {p.id !== profile.id && (
                <div className="btn-row" style={{ marginTop: 10 }}>
                  <form action={setMember}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="role" value={p.role === 'owner' ? 'worker' : 'owner'} />
                    <button className="btn ghost sm" style={{ width: '100%' }}>{p.role === 'owner' ? 'Quitar encargada' : 'Hacer encargada'}</button>
                  </form>
                  <form action={setMember}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="active" value={p.active ? '0' : '1'} />
                    <button className="btn danger sm" style={{ width: '100%' }}>{p.active ? 'Dar de baja' : 'Reactivar'}</button>
                  </form>
                </div>
              )}
            </details>
          );
        })}
      </div>
      <a className="btn soft" href={`/admin/export?m=${month}`}>Descargar registro de {monthName(month)} (CSV)</a>

      <h2>Horario de los turnos</h2>
      <form action={saveTemplates} className="card" style={{ gap: 12 }}>
        <div className="small muted">Son las horas que se ponen al tocar Mañana o Tarde en el cuadrante. Cambiarlas no modifica los turnos ya puestos.</div>
        {templates.map((t) => (
          <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input type="hidden" name="id" value={t.id} />
            <div style={{ fontWeight: 700 }}>{t.name}</div>
            <div className="grid2">
              <label>Entrada<input type="time" name={`start_${t.id}`} defaultValue={t.start_time.slice(0, 5)} required /></label>
              <label>Salida<input type="time" name={`end_${t.id}`} defaultValue={t.end_time.slice(0, 5)} required /></label>
            </div>
          </div>
        ))}
        <button className="btn">Guardar horarios</button>
      </form>

      <h2>QR para fichar</h2>
      <div className="card" style={{ alignItems: 'center', textAlign: 'center' }}>
        <div style={{ width: 240, height: 240 }} dangerouslySetInnerHTML={{ __html: qrSvg }} />
        <div style={{ fontFamily: 'var(--titulo)', fontWeight: 700, letterSpacing: '.08em', color: 'var(--espresso)' }}>ESCANEA PARA FICHAR</div>
        <div className="muted small noprint">Imprímelo y pégalo junto a la barra. Si sospechas que alguien lo tiene en una foto, cámbialo y vuelve a imprimirlo.</div>
        <div className="btn-row noprint" style={{ width: '100%', marginTop: 6 }}>
          <a className="btn sm" href="/admin/qr" target="_blank">Imprimir</a>
          <form action={rotateQr}><button className="btn ghost sm" style={{ width: '100%' }}>Cambiar QR</button></form>
        </div>
      </div>

      <h2>Código para crear cuenta</h2>
      <div className="card">
        <div className="big" style={{ fontSize: 26, letterSpacing: '.08em' }}>{code?.join_code}</div>
        <div className="muted small">Pásaselo a quien entre nuevo para que se registre como trabajador.</div>
      </div>
    </>
  );
}
