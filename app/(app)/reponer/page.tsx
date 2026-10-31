import { requireProfile } from '@/lib/supabase';
import { AddStockForm, StockRow } from '../Forms';
import { deleteStock, markOrdered, updateStockItem } from '../actions';

export const dynamic = 'force-dynamic';

type Item = {
  id: string; name: string; place: string | null; status: number; category: string;
  profiles: { full_name: string } | null;
};

/** Orden fijo de las categorías; las nuevas que se creen van al final, por orden alfabético. */
const ORDER = ['Leches y nata', 'Siropes y polvos', 'Bebidas frigo', 'Tés e infusiones', 'Take away', 'Azúcar', 'Café y hielo', 'Servilletas'];
const rank = (c: string) => { const i = ORDER.indexOf(c); return i === -1 ? 100 : i; };

export default async function Reponer() {
  const { sb, profile } = await requireProfile();
  const owner = profile.role === 'owner';
  const { data } = await sb.from('stock_items')
    .select('id, name, place, status, category, profiles:updated_by(full_name)')
    .order('sort').order('name');
  const items = (data ?? []) as unknown as Item[];

  const groups = new Map<string, Item[]>();
  for (const i of items) groups.set(i.category || 'Otros', [...(groups.get(i.category || 'Otros') ?? []), i]);
  const cats = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'es'));
  const toOrder = items.filter((i) => i.status > 0);

  return (
    <>
      <h1>Reposición</h1>
      <div className="cols wide-left">
        <div className="col">
          <p className="muted" style={{ margin: 0 }}>Toca un producto para cambiar: Hay → Queda poco → Falta.</p>

          {cats.map((c) => {
            const list = groups.get(c)!;
            const missing = list.filter((i) => i.status === 2).length;
            const low = list.filter((i) => i.status === 1).length;
            return (
              <details key={c} className="list" open>
                <summary className="row" style={{ background: 'var(--mantequilla)', cursor: 'pointer' }}>
                  <span className="eyebrow" style={{ color: 'var(--espresso)' }}>{c}</span>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {missing > 0 && <span className="pill out">{missing} falta{missing > 1 ? 'n' : ''}</span>}
                    {low > 0 && <span className="pill low">{low} poco</span>}
                    <span className="small muted">{list.length}</span>
                  </span>
                </summary>
                {list.map((i) => (
                  <StockRow key={`${i.id}-${i.status}`} id={i.id} name={i.name} place={i.place} status={i.status}
                    updatedBy={i.profiles?.full_name?.split(' ')[0]} />
                ))}
              </details>
            );
          })}
          {items.length === 0 && <div className="card"><div className="muted">Aún no hay productos.</div></div>}
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

          {toOrder.length > 0 && (
            <div className="card" style={{ gap: 10 }}>
              <div className="eyebrow">Lista para pedir</div>
              {cats.filter((c) => groups.get(c)!.some((i) => i.status > 0)).map((c) => (
                <div key={c} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div className="small" style={{ fontWeight: 700, color: 'var(--suave)' }}>{c}</div>
                  {groups.get(c)!.filter((i) => i.status > 0).map((i) => (
                    <div key={i.id} style={{ fontSize: 15 }}>
                      <span style={{ color: i.status === 2 ? 'var(--terracota)' : '#5C4310', fontWeight: 700 }}>{i.status === 2 ? 'Falta' : 'Poco'}</span>
                      {' · '}{i.name}{i.place ? <span className="muted small"> ({i.place})</span> : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {owner && (
            <details className="card">
              <summary className="btn ghost">+ Añadir o editar productos</summary>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <AddStockForm categories={cats} />
                {cats.map((c) => (
                  <details key={c} className="list" style={{ background: 'var(--crema)' }}>
                    <summary className="row" style={{ cursor: 'pointer' }}>
                      <span style={{ fontWeight: 700 }}>{c}</span><span className="small muted">editar</span>
                    </summary>
                    {groups.get(c)!.map((i) => (
                      <div key={i.id} className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                        <form action={updateStockItem} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <input type="hidden" name="id" value={i.id} />
                          <div className="grid2">
                            <label>Producto<input name="name" defaultValue={i.name} required /></label>
                            <label>Categoría<input name="category" defaultValue={i.category} list="stock-categories" required /></label>
                          </div>
                          <label>Nota<input name="place" defaultValue={i.place ?? ''} /></label>
                          <button className="btn ghost sm">Guardar</button>
                        </form>
                        <form action={deleteStock}>
                          <input type="hidden" name="id" value={i.id} />
                          <button className="btn danger sm" style={{ width: '100%' }} aria-label={`Quitar ${i.name}`}>Quitar {i.name}</button>
                        </form>
                      </div>
                    ))}
                  </details>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </>
  );
}
