import { requireProfile } from '@/lib/supabase';
import { AddStockForm, StockRow } from '../Forms';
import { deleteStock, markOrdered } from '../actions';

export const dynamic = 'force-dynamic';

type Item = { id: string; name: string; place: string | null; status: number; profiles: { full_name: string } | null };

export default async function Reponer() {
  const { sb, profile } = await requireProfile();
  const owner = profile.role === 'owner';
  const { data } = await sb.from('stock_items')
    .select('id, name, place, status, profiles:updated_by(full_name)')
    .order('sort').order('name');
  const items = (data ?? []) as unknown as Item[];
  const toOrder = items.filter((i) => i.status > 0);

  return (
    <>
      <h1>Reposición</h1>
      <div className="cols wide-left">
      <div className="col">
      <p className="muted" style={{ margin: 0 }}>Toca un producto para cambiar: Hay → Queda poco → Falta.</p>

      <div className="list">
        {items.map((i) => (
          <StockRow key={`${i.id}-${i.status}`} id={i.id} name={i.name} place={i.place} status={i.status} updatedBy={i.profiles?.full_name?.split(' ')[0]} />
        ))}
        {items.length === 0 && <div className="row muted">Aún no hay productos.</div>}
      </div>

      </div>
      <div className="col sticky first-mobile">
      <div className="card dark" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="eyebrow">Para el próximo pedido</div>
          <div className="big" style={{ fontSize: 22 }}>{toOrder.length} {toOrder.length === 1 ? 'producto' : 'productos'}</div>
        </div>
        {owner && toOrder.length > 0 && (
          <form action={markOrdered}>
            <button className="btn soft sm">Pedido hecho</button>
          </form>
        )}
      </div>
      {owner && toOrder.length > 0 && (
        <div className="card">
          <div className="eyebrow">Lista para pedir</div>
          {toOrder.map((i) => (
            <div key={i.id} style={{ fontSize: 15 }}>{i.status === 2 ? '● Falta' : '○ Queda poco'} — {i.name}{i.place ? ` (${i.place})` : ''}</div>
          ))}
        </div>
      )}

      {owner && (
        <details className="card">
          <summary className="btn ghost">+ Añadir o quitar productos</summary>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <AddStockForm />
            <div className="list" style={{ background: 'var(--crema)' }}>
              {items.map((i) => (
                <form key={i.id} action={deleteStock} className="row">
                  <input type="hidden" name="id" value={i.id} />
                  <span>{i.name}</span>
                  <button className="btn danger sm" aria-label={`Quitar ${i.name}`}>Quitar</button>
                </form>
              ))}
            </div>
          </div>
        </details>
      )}
      </div>
      </div>
    </>
  );
}
