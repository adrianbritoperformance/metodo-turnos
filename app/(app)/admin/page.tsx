import Link from 'next/link';
import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { requireOwner } from '@/lib/supabase';
import { fmtDay, fmtTime, monthName, shiftMonth, shortTime, ymd } from '@/lib/time';
import { JOBS } from '@/lib/jobs';
import { BlockForm, TaskRuleForm, VoidPunchForm } from '../Forms';
import { deleteBlock, deleteTaskRule, reviewCorrection, rotateQr, saveTemplates, shiftFromPunches } from '../actions';

export const dynamic = 'force-dynamic';

type Corr = {
  id: string; kind: 'in' | 'out'; requested_at: string; reason: string | null;
  profiles: { full_name: string } | null; shifts: { starts_at: string; ends_at: string } | null;
};

export default async function Admin() {
  const { sb } = await requireOwner();
  const month = ymd().slice(0, 7);

  const [{ data: corr }, { data: codes }, { data: tpls }, { data: orphans }, { data: blk }, { data: rules }, { data: prf }] = await Promise.all([
    sb.from('corrections').select('id, kind, requested_at, reason, profiles:user_id(full_name), shifts(starts_at, ends_at)')
      .eq('status', 'pending').order('created_at'),
    sb.rpc('get_admin_codes'),
    sb.from('shift_templates').select('id, name, start_time, end_time, weekdays').order('sort'),
    sb.from('punches').select('id, user_id, kind, at, profiles:user_id(full_name)').is('shift_id', null).is('voided_at', null)
      .gte('at', new Date(Date.now() - 62 * 86400e3).toISOString()).order('at'),
    sb.from('day_blocks').select('id, weekdays, start_time, end_time').order('start_time'),
    sb.from('task_rules').select('id, body, weekdays, user_ids, jobs, part').order('created_at'),
    sb.from('profiles').select('id, full_name, active, job_title').order('full_name'),
  ]);
  const templates = (tpls ?? []) as { id: string; name: string; start_time: string; end_time: string; weekdays: number[] }[];
  const blocks = (blk ?? []) as { id: string; weekdays: number[]; start_time: string; end_time: string }[];
  const taskRules = (rules ?? []) as { id: string; body: string; weekdays: number[]; user_ids: string[]; jobs: string[]; part: string }[];
  const ppl = ((prf ?? []) as { id: string; full_name: string; active: boolean; job_title: string | null }[]).filter((p) => p.active);
  const nameOf = new Map(ppl.map((p) => [p.id, p.full_name.split(' ')[0]]));
  const jobs = [...new Set([...JOBS, ...ppl.map((p) => p.job_title).filter((j): j is string => !!j)])]
    .filter((j) => !/due|admin/i.test(j));
  const DN = ['', 'L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const daysLabel = (w: number[]) => {
    const s = [...w].sort();
    const run = s.every((v, i) => i === 0 || v === s[i - 1] + 1);
    return s.length === 7 ? 'todos los días' : run && s.length > 2 ? `${DN[s[0]]}–${DN[s[s.length - 1]]}` : s.map((v) => DN[v]).join(', ');
  };
  const PART: Record<string, string> = { any: '', morning: ' · por la mañana', afternoon: ' · por la tarde' };
  // Franjas agrupadas por día de la semana, para ver el horario de un vistazo
  const WD = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

  const pending = (corr ?? []) as unknown as Corr[];

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

      <div className="cols">
        <div className="col">
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

      <h2>Horas trabajadas</h2>
      <div className="card" style={{ gap: 8 }}>
        <div className="small">El saldo de cada persona, semana a semana, está en <Link href="/horas">Bolsa de horas</Link>.</div>
        <div className="btn-row">
          <a className="btn soft sm" href={`/admin/export?m=${month}`}>Excel de {monthName(month).toLowerCase()}</a>
          <a className="btn ghost sm" href={`/admin/export?m=${shiftMonth(month, -1)}`}>Excel de {monthName(shiftMonth(month, -1)).toLowerCase()}</a>
        </div>
        <div className="small muted">Herramienta de organización interna del local. No sustituye al registro de jornada oficial.</div>
      </div>

      <h2>Tareas que se repiten</h2>
      <div className="small muted" style={{ marginTop: -6 }}>Salen solas los días marcados a quien tenga ese puesto (o a esa persona) y trabaje ese día. Las tareas de un solo día se ponen en Turnos y calendario.</div>
      {taskRules.length > 0 && (
        <div className="list">
          {taskRules.map((r) => (
            <div key={r.id} className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div className="t" style={{ whiteSpace: 'pre-line' }}>{r.body}</div>
                <div className="small muted">
                  {daysLabel(r.weekdays)}{PART[r.part] ?? ''} · para {[...r.jobs, ...r.user_ids.map((u) => nameOf.get(u) ?? '—')].join(', ')}
                </div>
              </div>
              <form action={deleteTaskRule}>
                <input type="hidden" name="id" value={r.id} />
                <button className="small" style={{ background: 'none', border: 0, color: 'var(--terracota)', textDecoration: 'underline', cursor: 'pointer', minHeight: 36 }}>Borrar</button>
              </form>
            </div>
          ))}
        </div>
      )}
      <details className="card">
        <summary className="btn ghost">+ Nueva tarea que se repite</summary>
        <div style={{ marginTop: 12 }}>
          <TaskRuleForm jobs={jobs} people={ppl.map((p) => ({ id: p.id, full_name: p.full_name }))} />
        </div>
      </details>

        </div>
        <div className="col">
      <h2>Franjas del horario</h2>
      <div className="small muted" style={{ marginTop: -6 }}>Son las columnas de la tabla de Horario. Si cambiáis el horario del local (abrir el lunes por la mañana, cerrar el sábado por la tarde…), se cambia aquí. Los turnos ya puestos no se tocan.</div>
      <div className="list">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => {
          const list = blocks.filter((b) => b.weekdays.includes(d));
          return (
            <div key={d} className="row">
              <span className="t">{WD[d]}</span>
              <span className="small" style={{ textAlign: 'right' }}>{list.length ? list.map((b) => `${shortTime(b.start_time)}–${shortTime(b.end_time)}`).join(' · ') : 'Cerrado'}</span>
            </div>
          );
        })}
      </div>
      <details className="card">
        <summary className="btn ghost">Cambiar franjas</summary>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {blocks.map((b) => (
            <div key={b.id} style={{ borderBottom: '1px solid var(--linea)', paddingBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <BlockForm block={{ id: b.id, start: b.start_time.slice(0, 5), end: b.end_time.slice(0, 5), weekdays: b.weekdays }} />
              <form action={deleteBlock}>
                <input type="hidden" name="id" value={b.id} />
                <button className="btn danger sm" style={{ width: '100%' }}>Quitar franja {shortTime(b.start_time)}–{shortTime(b.end_time)}</button>
              </form>
            </div>
          ))}
          <div className="eyebrow">Nueva franja</div>
          <BlockForm />
        </div>
      </details>

      <h2>Mañana y tarde de Plantilla</h2>
      <form action={saveTemplates} className="card" style={{ gap: 12 }}>
        <div className="small muted">Las horas que se ponen al tocar Mañana o Tarde en Plantilla y Turnos (la forma antigua de hacer el horario). Cambiarlas no modifica los turnos ya puestos.</div>
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
        </div>
      </div>
    </>
  );
}
