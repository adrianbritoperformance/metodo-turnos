import { requireSuperadmin } from '@/lib/supabase';
import { TZ } from '@/lib/time';
import { AccountForm, JOBS, NewBusinessForm, TempPasswordForm } from './Forms';

export const dynamic = 'force-dynamic';

type Account = {
  user_id: string; email: string; full_name: string; role: string; job_title: string | null; active: boolean;
  business_id: string; business_name: string; created_at: string; last_sign_in_at: string | null;
};
type Biz = { id: string; name: string; join_code: string; accounts: number; owners: number; created_at: string };

const when = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });

/** Panel central: todas las cuentas y locales de la plataforma. Solo el administrador central. */
export default async function Central() {
  const { sb, profile } = await requireSuperadmin();
  const [{ data: acc }, { data: biz }] = await Promise.all([sb.rpc('sa_list_accounts'), sb.rpc('sa_list_businesses')]);
  const accounts = (acc ?? []) as Account[];
  const businesses = (biz ?? []) as Biz[];

  return (
    <>
      <h1>Central</h1>
      <p className="muted" style={{ margin: 0 }}>Solo tú ves esta pantalla. Aquí decides qué vista tiene cada cuenta: <b>Admin</b> (dueños: Gestión, cuadrante, nóminas) o <b>Equipo</b>.</p>
      <datalist id="jobs">{JOBS.map((j) => <option key={j} value={j} />)}</datalist>

      <div className="cols wide-left">
        <div className="col">
          {businesses.map((b) => {
            const list = accounts.filter((a) => a.business_id === b.id);
            return (
              <section key={b.id} className="list" aria-label={b.name}>
                <div className="row" style={{ background: 'var(--mantequilla)' }}>
                  <div>
                    <div className="eyebrow" style={{ color: 'var(--espresso)' }}>{b.name}</div>
                    <div className="small">{b.accounts} cuentas · {b.owners} con vista admin · código <b>{b.join_code}</b></div>
                  </div>
                </div>
                {list.length === 0 && <div className="row muted small">Aún no se ha registrado nadie con el código {b.join_code}.</div>}
                {list.map((a) => (
                  <div key={a.user_id} style={{ borderBottom: '1px solid var(--linea)' }}>
                    <AccountForm a={a} me={a.user_id === profile.id} />
                    <TempPasswordForm userId={a.user_id} name={a.full_name.split(' ')[0]} />
                  </div>
                ))}
              </section>
            );
          })}
        </div>

        <div className="col sticky">
          <div className="card">
            <div className="eyebrow">Resumen</div>
            <div style={{ fontSize: 15 }}>{businesses.length} {businesses.length === 1 ? 'local' : 'locales'} · {accounts.filter((a) => a.active).length} cuentas activas</div>
            <div className="small muted">Última alta: {accounts.length ? when.format(new Date(accounts.reduce((m, a) => (a.created_at > m ? a.created_at : m), accounts[0].created_at))) : '—'}</div>
          </div>

          <details className="card">
            <summary className="btn ghost">+ Nuevo local</summary>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="small muted">Para vender la app a otra cafetería. Les das el código y la primera persona que se registre con él queda como admin de ese local.</div>
              <NewBusinessForm />
            </div>
          </details>

          <div className="card">
            <div className="eyebrow">Cómo funciona</div>
            <div className="small">
              <b>Vista admin:</b> Inicio con avisos del equipo, Gestión, poner turnos, ausencias, mensajes y tareas, cerrar nóminas.<br />
              <b>Vista equipo:</b> fichar, ver sus turnos y su bolsa de horas, reponer.<br />
              <b>Puesto:</b> solo una etiqueta (Barista, Cocina…), no cambia lo que ve.<br />
              <b>De baja:</b> no puede fichar ni aparece en el cuadrante; su historial se conserva.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
