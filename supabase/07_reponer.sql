-- =====================================================================
-- Método Café · Actualización 7: Reponer por categorías
-- Ejecutar entero en Supabase → SQL Editor (una vez), DESPUÉS de 06_solapes.sql.
-- =====================================================================

alter table public.stock_items add column if not exists category text not null default 'Otros';

-- Quita los 6 productos de ejemplo del principio (si siguen ahí) y carga la lista real.
delete from public.stock_items
 where name in ('Leche entera','Bebida de avena barista','Café de espresso','Vasos 8 oz para llevar','Tapas vasos 8 oz','Sobres de azúcar')
   and place in ('Barra · cajas de 6 L','Tolva · bolsas 1 kg','Almacén · mangas de 50','Almacén · mangas de 100','Sala · caja');

insert into public.stock_items (business_id, category, name, place, sort)
select b.id, x.cat, x.name, x.place, x.sort
  from public.businesses b,
  (values
    -- Leches y nata
    ('Leches y nata', 'Entera', null, 101),
    ('Leches y nata', 'Sin lactosa', null, 102),
    ('Leches y nata', 'Avena', null, 103),
    ('Leches y nata', 'Soja', null, 104),
    ('Leches y nata', 'Coco', null, 105),
    ('Leches y nata', 'Almendra', null, 106),
    ('Leches y nata', 'Nata', null, 107),
    ('Leches y nata', 'Nata sin lactosa', null, 108),
    -- Siropes y polvos
    ('Siropes y polvos', 'Sirope coco', null, 201),
    ('Siropes y polvos', 'Sirope fresa', null, 202),
    ('Siropes y polvos', 'Sirope chocolate', null, 203),
    ('Siropes y polvos', 'Sirope chocolate blanco', null, 204),
    ('Siropes y polvos', 'Sirope caramelo', null, 205),
    ('Siropes y polvos', 'Pumpkin', null, 206),
    ('Siropes y polvos', 'Matcha', null, 207),
    ('Siropes y polvos', 'Chai', null, 208),
    ('Siropes y polvos', 'Chai vainilla', null, 209),
    ('Siropes y polvos', 'Colacao', null, 210),
    -- Bebidas frigo
    ('Bebidas frigo', 'Batido chocolate', null, 301),
    ('Bebidas frigo', 'Batido fresa', null, 302),
    ('Bebidas frigo', 'Batido vainilla', null, 303),
    ('Bebidas frigo', 'Zumo piña', null, 304),
    ('Bebidas frigo', 'Zumo melocotón', null, 305),
    ('Bebidas frigo', 'Botella de agua', null, 306),
    ('Bebidas frigo', 'Agua con gas', null, 307),
    ('Bebidas frigo', 'Tónica', null, 308),
    -- Tés e infusiones
    ('Tés e infusiones', 'Té negro', null, 401),
    ('Tés e infusiones', 'Té verde', null, 402),
    ('Tés e infusiones', 'Té rojo', null, 403),
    ('Tés e infusiones', 'Rooibos', null, 404),
    ('Tés e infusiones', 'Manzanilla', null, 405),
    ('Tés e infusiones', 'Menta poleo', null, 406),
    -- Take away
    ('Take away', 'Vasos to go caliente pequeños', null, 501),
    ('Take away', 'Vasos to go caliente grandes', null, 502),
    ('Take away', 'Vasos to go fríos', 'Pedir otros que encajen con las tapas', 503),
    ('Take away', 'Tapas vasos fríos', null, 504),
    ('Take away', 'Palitos remover', null, 505),
    ('Take away', 'Cañitas', null, 506),
    ('Take away', 'Pegatinas', 'Las de los vasos', 507),
    -- Azúcar
    ('Azúcar', 'Azúcar blanca', null, 601),
    ('Azúcar', 'Azúcar moreno', null, 602),
    ('Azúcar', 'Sacarina', null, 603),
    -- Café y hielo
    ('Café y hielo', 'Café espresso', null, 701),
    ('Café y hielo', 'Hielo', null, 702),
    -- Servilletas
    ('Servilletas', 'Servilletas', null, 801),
    ('Servilletas', 'Servilletas baño', null, 802)
  ) as x(cat, name, place, sort)
 where not exists (
   select 1 from public.stock_items s
    where s.business_id = b.id and lower(s.name) = lower(x.name)
 );

-- Orden de las categorías (lo usa la app para mostrarlas siempre igual).
create or replace function public.stock_category_order(c text) returns int
language sql immutable as $$
  select case c
    when 'Leches y nata' then 1 when 'Siropes y polvos' then 2 when 'Bebidas frigo' then 3
    when 'Tés e infusiones' then 4 when 'Take away' then 5 when 'Azúcar' then 6
    when 'Café y hielo' then 7 when 'Servilletas' then 8 else 50 end
$$;
