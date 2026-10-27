import { requireProfile } from '@/lib/supabase';
import { addDays, dayRange, fmtDay, fmtTime, ymd } from '@/lib/time';
import { Scanner } from './Scanner';

type Shift = { id: string; starts_at: string; ends_at: string; label: string | null; note: string | null; changed_at: string | null };

export async function Home({ autoCode }: { autoCode?: string }) {
  const { sb, profile } = await requireProfile();
  const today = ymd();
  const { from, to } = dayRange(today);
  const { from: weekFrom } = dayRange(addDays(today, 1));
  const { to: weekTo } = dayRange(addDays(today, 7));

  const [{ data: todayShifts }, { data: last }, { data: upcoming }] = await Promise.all([
    sb.from('shifts').select('id, starts_at, ends_at, label, note, changed_at')
      .eq('user_id', profile.id).gte('starts_at', from).lt('starts_at', to).order('starts_at'),
    sb.from('punches').select('kind, at').eq('user_id', profile.id)
      .gte('at', new Date(Date.now() - 16 * 3600e3).toISOString()).order('at', { ascending: false }).limit(1),
    sb.from('shifts').select('id, starts_at, ends_at, label, note, changed_at')
      .eq('user_id', profile.id).gte('starts_at', weekFrom).lt('starts_at', weekTo).order('starts_at'),
  ]);

  const shifts = (todayShifts ?? []) as Shift[];
  const next = (upcoming ?? []) as Shift[];
  const nextKind: 'in' | 'out' = last?.[0]?.kind === 'in' ? 'out' : 'in';
  const recentlyChanged = (s: Shift) => s.changed_at && Date.now() - new Date(s.changed_at).getTime() < 48 * 3600e3;
  const firstName = profile.full_name.split(' ')[0];

  return (
    <>
      <h1>Hola, {firstName}</h1>

      {shifts.length === 0 ? (
        <div className="card yellow">
          <div className="eyebrow">Hoy</div>
          <div className="big" style={{ fontSize: 24 }}>Sin turno asignado</div>
        </div>
      ) : shifts.map((s) => (
        <div key={s.id} className="card yellow">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <div className="eyebrow">Tu turno de hoy</div>
            {recentlyChanged(s) && <span className="pill out">Turno cambiado</span>}
          </div>
          <div className="big">{fmtTime(s.starts_at)} – {fmtTime(s.ends_at)}</div>
          {s.label && <div className="muted">{s.label}</div>}
        </div>
      ))}

      {last?.[0]?.kind === 'in' && (
        <div className="muted">Entrada fichada a las <b>{fmtTime(last[0].at)}</b>.</div>
      )}

      <Scanner nextKind={nextKind} autoCode={autoCode} />

      {shifts.filter((s) => s.note).map((s) => (
        <div key={s.id + 'n'} className="card" style={{ flexDirection: 'row', gap: 12 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7A3A1F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}>
            <path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="eyebrow" style={{ color: 'var(--terracota)' }}>Tarea del turno</div>
            <div style={{ fontSize: 15, whiteSpace: 'pre-line' }}>{s.note}</div>
          </div>
        </div>
      ))}

      {next.length > 0 && (
        <>
          <h2>Próximos turnos</h2>
          <div className="list">
            {next.map((s) => (
              <div key={s.id} className="row">
                <div>
                  <div className="t">{fmtDay(s.starts_at)}</div>
                  {s.label && <div className="muted small">{s.label}</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {recentlyChanged(s) && <span className="pill out">Cambiado</span>}
                  <div className="num">{fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
