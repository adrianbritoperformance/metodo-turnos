import { TZ } from '@/lib/time';
import type { Notice } from '@/lib/notices';
import type { RuleTask } from '@/lib/notices';
import { NoticeDone, RuleDone } from './NoticeDone';
import { deleteMyMessage, deleteNotice } from './actions';

const hm = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

/** Lista de mensajes y tareas de un día. */
export function NoticeList({ notices, nameById, owner, empty, me }: {
  notices: Notice[]; nameById: Map<string, string>; owner?: boolean; empty?: string; me?: string;
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
              {!owner && me && n.created_by === me && (
                <form action={deleteMyMessage}>
                  <input type="hidden" name="id" value={n.id} />
                  <button className="small" aria-label="Borrar mensaje"
                    style={{ background: 'none', border: 0, color: 'var(--terracota)', textDecoration: 'underline', cursor: 'pointer', minHeight: 36 }}>
                    Borrar
                  </button>
                </form>
              )}
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

const PART: Record<string, string> = { any: '', morning: ' · mañana', afternoon: ' · tarde' };

/** Tareas que se repiten (checklist del día). */
export function RuleTaskList({ tasks, day, nameById, owner }: {
  tasks: RuleTask[]; day: string; nameById: Map<string, string>; owner?: boolean;
}) {
  if (tasks.length === 0) return null;
  return (
    <div className="list">
      {tasks.map((t) => {
        const nobody = t.assignees.length === 0;
        return (
          <div key={t.rule_id} className="row" style={{ alignItems: 'flex-start', gap: 10, background: nobody ? 'var(--terracota-bg)' : undefined }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <span className="pill low" style={{ alignSelf: 'flex-start' }}>Tarea de cada semana</span>
              <div style={{ fontSize: 15, whiteSpace: 'pre-line' }}>{t.body}</div>
              {owner && (
                <div className="small" style={{ color: nobody ? 'var(--terracota)' : 'var(--suave)' }}>
                  {nobody
                    ? `Sin nadie para esta tarea hoy${t.jobs.length ? ` (${t.jobs.join(', ')})` : ''}${PART[t.part] ?? ''}`
                    : `Para: ${t.assignees.map((u) => (nameById.get(u) ?? '—').split(' ')[0]).join(', ')}${PART[t.part] ?? ''}`}
                </div>
              )}
              {t.done_at && (
                <div className="small muted">Hecha por {(nameById.get(t.done_by ?? '') ?? '—').split(' ')[0]} a las {hm.format(new Date(t.done_at))}</div>
              )}
            </div>
            {!nobody && <RuleDone ruleId={t.rule_id} day={day} done={!!t.done_at} />}
          </div>
        );
      })}
    </div>
  );
}
