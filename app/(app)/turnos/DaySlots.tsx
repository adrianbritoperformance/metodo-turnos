import { fmtTime } from '@/lib/time';
import { ABSENCE, type Absence } from '@/lib/absences';

type Row = {
  id: string; user_id: string; starts_at: string; ends_at: string; label: string | null; note: string | null;
  changed_at: string | null; profiles: { full_name: string } | null;
};

const hourFmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false });
const isMorning = (iso: string) => Number(hourFmt.format(new Date(iso))) < 14;

/** El día partido en dos bloques: quién está de mañana, quién de tarde (y quién está ausente). */
export function DaySlots({ rows, me, colorById, nameById, absences }: {
  rows: Row[]; me: string; colorById: Map<string, string>; nameById: Map<string, string>; absences: Absence[];
}) {
  const blocks = [
    { title: 'Turno de mañana', list: rows.filter((r) => isMorning(r.starts_at)) },
    { title: 'Turno de tarde', list: rows.filter((r) => !isMorning(r.starts_at)) },
  ];
  if (rows.length === 0 && absences.length === 0) {
    return <div className="card"><div className="muted">No hay turnos este día.</div></div>;
  }
  return (
    <>
      {blocks.map((b) => (
        <section key={b.title} className="list" aria-label={b.title}>
          <div className="row slot-head" style={{ background: b.title.endsWith('mañana') ? 'var(--mantequilla)' : '#EADBC8' }}>
            <span className="eyebrow" style={{ color: 'var(--espresso)' }}>{b.title}</span>
            <span className="small muted">{b.list.length} {b.list.length === 1 ? 'persona' : 'personas'}</span>
          </div>
          {b.list.length === 0 && <div className="row muted small">Nadie</div>}
          {b.list.map((r) => {
            const mine = r.user_id === me;
            const changed = r.changed_at && Date.now() - new Date(r.changed_at).getTime() < 48 * 3600e3;
            return (
              <div key={r.id} className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, background: mine ? '#FBF3D6' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 16, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 99, background: colorById.get(r.user_id) }} />
                    {r.profiles?.full_name ?? '—'}{mine ? ' (tú)' : ''}
                  </span>
                  <span style={{ fontFamily: 'var(--titulo)', fontWeight: 700 }}>{fmtTime(r.starts_at)}–{fmtTime(r.ends_at)}</span>
                </div>
                {r.label && <div className="muted small">{r.label}</div>}
                {r.note && <div style={{ fontSize: 14, whiteSpace: 'pre-line' }}>Tarea: {r.note}</div>}
                {changed && <span className="pill out" style={{ alignSelf: 'flex-start' }}>Cambiado recientemente</span>}
              </div>
            );
          })}
        </section>
      ))}

      {absences.length > 0 && (
        <section className="list" aria-label="Ausentes">
          <div className="row slot-head" style={{ background: 'var(--papel)' }}>
            <span className="eyebrow">Ausentes</span>
          </div>
          {absences.map((a) => (
            <div key={a.id} className="row">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 99, background: colorById.get(a.user_id) }} />
                {nameById.get(a.user_id) ?? '—'}{a.user_id === me ? ' (tú)' : ''}
              </span>
              <span className="pill" style={{ background: ABSENCE[a.kind].bg, color: ABSENCE[a.kind].fg }}>{ABSENCE[a.kind].label}</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
