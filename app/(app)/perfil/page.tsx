import { requireProfile } from '@/lib/supabase';
import { PALETTE, colorOf } from '@/lib/colors';
import { setMyColor } from '../actions';
import { logout } from '../../login/actions';

export const dynamic = 'force-dynamic';

export default async function Perfil() {
  const { sb, profile } = await requireProfile();
  const { data } = await sb.from('profiles').select('id, color, active').order('full_name');
  const list = ((data ?? []) as { id: string; color: string | null; active: boolean }[]).filter((p) => p.active);
  const idx = Math.max(0, list.findIndex((p) => p.id === profile.id));
  const mine = colorOf(list[idx]?.color, idx);
  const taken = new Set(list.filter((p) => p.id !== profile.id && p.color).map((p) => p.color!.toUpperCase()));

  return (
    <div className="narrow" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h1>Mi perfil</h1>
      <div className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 99, background: mine }} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{profile.full_name}</div>
          <div className="muted small">{profile.role === 'owner' ? 'Encargada' : 'Equipo'}</div>
        </div>
      </div>

      <h2>Tu color en el calendario</h2>
      <form action={setMyColor} className="card" style={{ gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
          {PALETTE.map((c) => {
            const used = taken.has(c.hex.toUpperCase());
            return (
              <label key={c.hex} style={{ alignItems: 'center', gap: 4, color: 'var(--tinta)', fontWeight: 400, cursor: 'pointer' }}>
                <input type="radio" name="color" value={c.hex} defaultChecked={c.hex.toUpperCase() === mine.toUpperCase()}
                  style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
                <span className="swatch" style={{ background: c.hex }} />
                <span className="small">{c.name}{used ? ' ·' : ''}</span>
              </label>
            );
          })}
        </div>
        <div className="small muted">Los marcados con · ya los usa alguna compañera. Mejor elegir uno libre para distinguiros.</div>
        <button className="btn">Guardar color</button>
      </form>

      <form action={logout}>
        <button className="btn ghost" style={{ width: '100%' }}>Cerrar sesión</button>
      </form>
    </div>
  );
}
