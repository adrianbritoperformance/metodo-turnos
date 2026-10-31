import { TZ } from '@/lib/time';
import type { Notice } from '@/lib/notices';
import { NoticeDone } from './NoticeDone';
import { deleteNotice } from './actions';

const hm = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

/** Lista de mensajes y tareas de un día. */
export function NoticeList({ notices, nameById, owner, empty }: {
  notices: Notice[]; nameById: Map<string, string>; owner?: boolean; empty?: string;
}) {
  if (notices.length === 0) return empty ? <div className="card"><div className="muted small">{empty}</div></div> : null;
  return (
    <div className="list">
      {notices.map((n) => {
        const to = n.user_ids.length === 0 ? 'Todo el equipo' : n.user_ids.map((u) => (nameById.get(u) ?? '—').split(' ')[0]).join(', ');
        return (
          <div key={n.id} className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <span className={`pill ${n.kind === 'tarea' ? 'low' : 'dark'}`} style={{ alignSelf: 'flex-start' }}>
                {n.kind === 'tarea' ? 'Tarea' : 'Mensaje'}
              </span>
              <div style={{ fontSize: 15, whiteSpace: 'pre-line' }}>{n.body}</div>
              <div className="small muted">
                Para: {to}
                {n.created_by ? ` · de ${(nameById.get(n.created_by) ?? '').split(' ')[0]}` : ''}
                {n.done_at ? ` · hecha por ${(nameById.get(n.done_by ?? '') ?? '—').split(' ')[0]} a las ${hm.format(new Date(n.done_at))}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              {n.kind === 'tarea' && <NoticeDone id={n.id} done={!!n.done_at} />}
              {owner && (
                <form action={deleteNotice}>
                  <input type="hidden" name="id" value={n.id} />
                  <button className="small" aria-label="Borrar aviso"
                    style={{ background: 'none', border: 0, color: 'var(--terracota)', textDecoration: 'underline', cursor: 'pointer', minHeight: 36 }}>
                    Borrar
                  </button>
                </form>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
