import Link from 'next/link';
import { requireProfile } from '@/lib/supabase';
import { addDays, dayRange, fmtLongDay, fmtTime, madridMidnight, mondayOf, ymd } from '@/lib/time';
import { ShiftForm } from '../Forms';
import { deleteShift } from '../actions';

export const dynamic = 'force-dynamic';

type Row = {
  id: string; user_id: string; starts_at: string; ends_at: string; label: string | null; note: string | null;
  changed_at: string | null; profiles: { full_name: string } | null;
};

const WD = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

export default async function Turnos({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { d } = await searchParams;
  const day = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ymd();
  const { sb, profile } = await requireProfile();
  const owner = profile.role === 'owner';
  const { from, to } = dayRange(day);
  const mon = mondayOf(day);
  const week = Array.from({ length: 7 }, (_, i) => addDays(mon, i));

  const [{ data }, { data: people }] = await Promise.all([
    sb.from('shifts').select('id, user_id, starts_at, ends_at, label, note, changed_at, profiles(full_name)')
      .gte('starts_at', from).lt('starts_at', to).order('starts_at'),
    owner
      ? sb.from('profiles').select('id, full_name').eq('active', true).order('full_name')
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const team = (people ?? []) as { id: string; full_name: string }[];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>{owner ? 'Cuadrante' : 'Turnos'}</h1>
        <Link className="btn ghost sm" href="/turnos">Hoy</Link>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Link className="btn ghost sm" href={`/turnos?d=${addDays(mon, -7)}`} aria-label="Semana anterior" style={{ padding: '0 10px' }}>‹</Link>
        <div className="days" style={{ flex: 1 }}>
          {week.map((w, i) => (
            <Link key={w} href={`/turnos?d=${w}`} className={w === day ? 'on' : ''} aria-current={w === day ? 'date' : undefined}>
              <span>{WD[i]}</span><span>{Number(w.slice(8))}</span>
            </Link>
          ))}
        </div>
        <Link className="btn ghost sm" href={`/turnos?d=${addDays(mon, 7)}`} aria-label="Semana siguiente" style={{ padding: '0 10px' }}>›</Link>
      </div>

      <h2>{fmtLongDay(madridMidnight(day))}</h2>

      {rows.length === 0 && <div className="card"><div className="muted">No hay turnos este día.</div></div>}

      {rows.map((r) => {
        const mine = r.user_id === profile.id;
        const changed = r.changed_at && Date.now() - new Date(r.changed_at).getTime() < 48 * 3600e3;
        const body = (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{r.profiles?.full_name ?? '—'}{mine ? ' (tú)' : ''}</div>
              <div className="num" style={{ fontFamily: 'var(--titulo)', fontWeight: 700 }}>{fmtTime(r.starts_at)}–{fmtTime(r.ends_at)}</div>
            </div>
            {r.label && <div className="muted">{r.label}</div>}
            {r.note && <div style={{ fontSize: 14, whiteSpace: 'pre-line' }}>Tarea: {r.note}</div>}
            {changed && <span className="pill out" style={{ alignSelf: 'flex-start' }}>Cambiado recientemente</span>}
          </>
        );
        if (!owner) return <div key={r.id} className={`card ${mine ? 'yellow' : ''}`}>{body}</div>;
        return (
          <details key={r.id} className={`card ${mine ? 'yellow' : ''}`}>
            <summary style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{body}<span className="small" style={{ color: 'var(--suave)', textDecoration: 'underline' }}>Editar</span></summary>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <ShiftForm people={team} submit="Guardar cambios" d={{
                id: r.id, user_id: r.user_id, date: ymd(r.starts_at), start: fmtTime(r.starts_at), end: fmtTime(r.ends_at),
                label: r.label ?? '', note: r.note ?? '',
              }} />
              <form action={deleteShift}>
                <input type="hidden" name="id" value={r.id} />
                <button className="btn danger" style={{ width: '100%' }}>Borrar turno</button>
              </form>
            </div>
          </details>
        );
      })}

      {owner && (
        <details className="card">
          <summary className="btn">+ Añadir turno</summary>
          <div style={{ marginTop: 12 }}>
            <ShiftForm people={team} d={{ date: day }} />
          </div>
        </details>
      )}
    </>
  );
}
