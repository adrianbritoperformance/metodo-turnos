import Link from 'next/link';
import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { requireOwner } from '@/lib/supabase';
import { addDays, fmtDay, fmtHours, fmtMinutes, fmtRange, fmtTime, madridMidnight, monthOnly, payMonthOf, payPeriod, shiftMonth, ymd } from '@/lib/time';
import { getPayStartDay, type Closing } from '@/lib/period';
import { ClosePeriodForm, OpeningForm, VoidPunchForm } from '../Forms';
import { reviewCorrection, rotateQr, saveTemplates, setContract, setMember, setPayStartDay, shiftFromPunches } from '../actions';

export const dynamic = 'force-dynamic';

type Corr = {
  id: string; kind: 'in' | 'out'; requested_at: string; reason: string | null;
  profiles: { full_name: string } | null; shifts: { starts_at: string; ends_at: string } | null;
};

export default async function Admin({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const { sb, profile } = await requireOwner();
  const startDay = await getPayStartDay(sb);
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : payMonthOf(ymd(), startDay);
  const { start, end } = payPeriod(month, startDay);

  const [{ data: corr }, { data: people }, { data: codes }, { data: tpls }, { data: closings }, { data: orphans }] = await Promise.all([
    sb.from('corrections').select('id, kind, requested_at, reason, profiles:user_id(full_name), shifts(starts_at, ends_at)')
      .eq('status', 'pending').order('created_at'),
    sb.rpc('get_contracts'),
    sb.rpc('get_admin_codes'),
    sb.from('shift_templates').select('id, name, start_time, end_time, weekdays').order('sort'),
    sb.from('pay_closings').select('*').lte('period_month', `${month}-01`).order('period_month', { ascending: false }),
    sb.from('punches').select('id, user_id, kind, at, profiles:user_id(full_name)').is('shift_id', null).is('voided_at', null)
      .gte('at', new Date(Date.now() - 62 * 86400e3).toISOString()).order('at'),
  ]);
  const templates = (tpls ?? []) as { id: string; name: string; start_time: string; end_time: string; weekdays: number[] }[];
  const DN = ['', 'L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const daysLabel = (w: number[]) => {
    const s = [...w].sort();
    const run = s.every((v, i) => i === 0 || v === s[i - 1] + 1);
    return s.length === 7 ? 'todos los días' : run && s.length > 2 ? `${DN[s[0]]}–${DN[s[s.length - 1]]}` : s.map((v) => DN[v]).join(', ');
  };

  const pending = (corr ?? []) as unknown as Corr[];
  const team = ((people ?? []) as { user_id: string; full_name: string; weekly_hours: number; role: string; active: boolean; opening_minutes: number; opening_note: string | null }[])
    .map((p) => ({ ...p, id: p.user_id, weekly_hours: Number(p.weekly_hours) }));
  const allClosings = (closings ?? []) as Closing[];

  // Saldo del periodo de cada persona (calculado en la base de datos)
  const balances = await Promise.all(team.map((p) => sb.rpc('period_balance', { p_user: p.id, p_month: `${month}-01` })));
  const rows = team.map((p, i) => {
    const b = (balances[i].data as { worked_minutes: number; contract_minutes: number; balance_minutes: number }[] | null)?.[0]
      ?? { worked_minutes: 0, contract_minutes: 0, balance_minutes: 0 };
    const mine = allClosings.filter((c) => c.user_id === p.id);
    const closing = mine.find((c) => c.period_month.slice(0, 7) === month) ?? null;
    const prev = mine.find((c) => c.period_month.slice(0, 7) < month);
    const carriedIn = closing ? closing.carried_in : prev ? prev.carried_out : p.opening_minutes;
    return { p, b, closing, carriedIn, total: carriedIn + b.balance_minutes };
  });
  const finished = madridMidnight(addDays(end, 1)).getTime() <= Date.now();

  // Fichajes sin turno, agrupados por persona y día
  type Orphan = { id: string; user_id: string; kind: 'in' | 'out'; at: string; profiles: { full_name: string } | null };
  const orphanGroups = new Map<string, { user_id: string; name: string; day: string; items: Orphan[] }>();
  for (const o of (orphans ?? []) as unknown as Orphan[]) {
    const k = `${o.user_id}|${ymd(o.at)}`;
    const g = orphanGroups.get(k) ?? { user_id: o.user_id, name: o.profiles?.full_name ?? '—', day: ymd(o.at), items: [] };
    g.items.push(o);
    orphanGroups.set(k, g);
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

      {orphanGroups.size > 0 && (
        <>
          <h2>Fichajes sin turno</h2>
          <div className="small muted" style={{ marginTop: -6 }}>Alguien fichó sin tener turno puesto (por ejemplo, cubrió a una compañera). Hasta que lo conviertas en turno, esas horas no cuentan.</div>
          {[...orphanGroups.values()].map((g) => (
            <div key={`${g.user_id}${g.day}`} className="card">
              <div style={{ fontWeight: 700 }}>{g.name} · {fmtDay(g.items[0].at)}</div>
              <div className="small">{g.items.map((o) => `${o.kind === 'in' ? 'Entrada' : 'Salida'} ${fmtTime(o.at)}`).join(' · ')}</div>
              <form action={shiftFromPunches}>
                <input type="hidden" name="user_id" value={g.user_id} />
                <input type="hidden" name="date" value={g.day} />
                <button className="btn sm" style={{ width: '100%' }}>Crear turno con estas horas</button>
              </form>
              <details>
                <summary className="small" style={{ color: 'var(--terracota)', textDecoration: 'underline', padding: '8px 0' }}>Fue un error: descartar</summary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                  {g.items.map((o) => <VoidPunchForm key={o.id} id={o.id} label={`${o.kind === 'in' ? 'Entrada' : 'Salida'} ${fmtTime(o.at)}`} />)}
                </div>
              </details>
            </div>
          ))}
        </>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>Nómina de {monthOnly(month)}</h2>
          <div className="small muted">{fmtRange(start, end)}{finished ? '' : ' · en curso'}</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Link className="btn ghost sm" href={`/admin?m=${shiftMonth(month, -1)}`} aria-label="Nómina anterior">‹</Link>
          <Link className="btn ghost sm" href={`/admin?m=${shiftMonth(month, 1)}`} aria-label="Nómina siguiente">›</Link>
        </div>
      </div>
      <div className="list">
        {rows.map(({ p, b, closing, carriedIn, total }) => (
          <details key={p.id} className="row" style={{ display: 'block' }}>
            <summary style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div>
                <div className="t">{p.full_name}{!p.active ? ' (baja)' : ''}</div>
                <div className="muted small">
                  {p.weekly_hours} h/sem · {fmtHours(b.worked_minutes)} de {fmtHours(b.contract_minutes)}
                </div>
                {closing
                  ? <span className={`pill ${closing.worker_status === 'agree' ? 'ok' : closing.worker_status === 'disagree' ? 'out' : 'low'}`} style={{ marginTop: 4 }}>
                      {closing.worker_status === 'agree' ? 'Cerrada · conforme' : closing.worker_status === 'disagree' ? 'Cerrada · NO conforme' : 'Cerrada · esperando respuesta'}
                    </span>
                  : finished ? <span className="pill low" style={{ marginTop: 4 }}>Sin cerrar</span> : null}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="num" style={{ color: (closing ? closing.carried_out : total) < 0 ? 'var(--terracota)' : undefined }}>
                  {fmtMinutes(closing ? closing.carried_out : total)}
                </div>
                <div className="small muted">{closing ? 'queda' : 'acumulado'}</div>
              </div>
            </summary>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
              <div className="card" style={{ background: 'var(--crema)' }}>
                <div className="small">Venía de antes: <b>{fmtMinutes(carriedIn)}</b> · Este periodo: <b>{fmtMinutes(closing ? closing.balance_minutes : b.balance_minutes)}</b></div>
                {closing && <div className="small">Pagadas: <b>{fmtHours(closing.paid_minutes)}</b> · Queda: <b>{fmtMinutes(closing.carried_out)}</b></div>}
                {closing?.worker_comment && <div className="small">Comentario de {p.full_name.split(' ')[0]}: “{closing.worker_comment}”</div>}
                {!finished && <div className="small muted">El periodo aún no ha terminado: si lo cierras ahora, se cuenta con los turnos puestos hasta el {Number(end.slice(8))}.</div>}
                <ClosePeriodForm userId={p.id} month={month} total={fmtMinutes(total)} paid={closing?.paid_minutes} note={closing?.note} />
              </div>

              <OpeningForm userId={p.id} minutes={p.opening_minutes} note={p.opening_note} />

              <form action={setContract} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <input type="hidden" name="id" value={p.id} />
                <label style={{ flex: 1 }}>Horas de contrato por semana
                  <input name="weekly_hours" type="number" min={0} max={60} step={0.5} defaultValue={p.weekly_hours} inputMode="decimal" />
                </label>
                <button className="btn sm">Guardar</button>
              </form>
              {p.id !== profile.id && (
                <div className="btn-row">
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
            </div>
          </details>
        ))}
      </div>
      <a className="btn soft" href={`/admin/export?m=${month}`}>Descargar registro de la nómina de {monthOnly(month)} (Excel)</a>

      <h2>Día de corte de la nómina</h2>
      <form action={setPayStartDay} className="card" style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        <label style={{ flex: 1 }}>La nómina empieza el día
          <input name="day" type="number" min={1} max={28} defaultValue={startDay} inputMode="numeric" />
        </label>
        <button className="btn sm">Guardar</button>
      </form>
      <div className="small muted" style={{ marginTop: -6 }}>Con 26, la nómina de noviembre va del 26 de octubre al 25 de noviembre. Con 1, el mes natural.</div>

      <h2>Horario de los turnos</h2>
      <form action={saveTemplates} className="card" style={{ gap: 12 }}>
        <div className="small muted">Son las horas que se ponen al tocar Mañana o Tarde en el cuadrante. Cambiarlas no modifica los turnos ya puestos.</div>
        {templates.map((t) => (
          <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input type="hidden" name="id" value={t.id} />
            <div style={{ fontWeight: 700 }}>{t.name} · {daysLabel(t.weekdays)}</div>
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
