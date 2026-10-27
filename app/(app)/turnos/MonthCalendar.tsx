import Link from 'next/link';
import { addDays, monthName, mondayOf, shiftMonth, ymd } from '@/lib/time';

const WD = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const hourFmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false });

export type CalPerson = { id: string; name: string; color: string };

/**
 * Calendario del mes: cada día partido en dos, arriba la mañana y abajo la tarde,
 * con un punto del color de cada persona que trabaja en esa franja.
 */
export function MonthCalendar({ month, day, shifts, people }: {
  month: string; day: string;
  shifts: { user_id: string; starts_at: string }[];
  people: CalPerson[];
}) {
  const color = new Map(people.map((p) => [p.id, p.color]));
  const name = new Map(people.map((p) => [p.id, p.name]));
  const slots = new Map<string, { am: string[]; pm: string[] }>();
  for (const s of shifts) {
    const k = ymd(s.starts_at);
    const v = slots.get(k) ?? { am: [], pm: [] };
    const h = Number(hourFmt.format(new Date(s.starts_at)));
    const list = h < 14 ? v.am : v.pm;
    if (!list.includes(s.user_id)) list.push(s.user_id);
    slots.set(k, v);
  }
  const order = new Map(people.map((p, i) => [p.id, i]));
  const sort = (ids: string[]) => [...ids].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));

  const cells: string[] = [];
  const next = `${shiftMonth(month, 1)}-01`;
  for (let c = mondayOf(`${month}-01`); c < next || cells.length % 7 !== 0; c = addDays(c, 1)) cells.push(c);
  const today = ymd();

  const Dots = ({ ids }: { ids: string[] }) => (
    <span className="cal-half" style={{ display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'center', alignContent: 'center', padding: '2px 1px' }}>
      {sort(ids).map((id) => (
        <span key={id} title={name.get(id)} className="cal-dot" style={{ background: color.get(id) ?? '#999' }} />
      ))}
    </span>
  );

  return (
    <div className="card" style={{ gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Link className="btn ghost sm" href={`/turnos?d=${shiftMonth(month, -1)}-01`} aria-label="Mes anterior" style={{ padding: '0 12px' }}>‹</Link>
        <div style={{ fontWeight: 700 }}>{monthName(month)}</div>
        <Link className="btn ghost sm" href={`/turnos?d=${shiftMonth(month, 1)}-01`} aria-label="Mes siguiente" style={{ padding: '0 12px' }}>›</Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 3 }}>
        {WD.map((w) => <div key={w} className="small" style={{ textAlign: 'center', color: 'var(--suave)', fontWeight: 700 }}>{w}</div>)}
        {cells.map((c) => {
          const inMonth = c.slice(0, 7) === month;
          const v = slots.get(c);
          const sel = c === day;
          const label = `${Number(c.slice(8))}. Mañana: ${v?.am.map((i) => name.get(i)).join(', ') || 'nadie'}. Tarde: ${v?.pm.map((i) => name.get(i)).join(', ') || 'nadie'}`;
          return (
            <Link
              key={c}
              href={`/turnos?d=${c}`}
              aria-current={sel ? 'date' : undefined}
              aria-label={label}
              style={{
                textDecoration: 'none', borderRadius: 9, overflow: 'hidden', display: 'flex', flexDirection: 'column',
                border: sel ? '2px solid var(--espresso)' : c === today ? '2px solid #B9A28E' : '2px solid transparent',
                opacity: inMonth ? 1 : 0.4, background: '#fff',
              }}
            >
              <span className="cal-num" style={{
                fontWeight: 700, textAlign: 'center',
                background: sel ? 'var(--espresso)' : 'transparent', color: sel ? '#F7EFE4' : 'var(--tinta)',
              }}>{Number(c.slice(8))}</span>
              <Dots ids={v?.am ?? []} />
              <span style={{ height: 1, background: 'var(--linea)' }} />
              <span style={{ background: '#F3EBE1' }}><Dots ids={v?.pm ?? []} /></span>
            </Link>
          );
        })}
      </div>

      <div className="small muted">En cada día: arriba la mañana, abajo la tarde. Toca un día para verlo.</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px' }}>
        {people.map((p) => (
          <span key={p.id} className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 99, background: p.color }} />{p.name}
          </span>
        ))}
      </div>
    </div>
  );
}
