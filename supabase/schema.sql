-- =====================================================================
-- Método Café · App de turnos
-- Ejecutar entero en Supabase → SQL Editor (una sola vez).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique,            -- código que se pide al registrarse
  qr_secret text not null unique default encode(gen_random_bytes(16), 'hex'),
  timezone text not null default 'Europe/Madrid',
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  full_name text not null,
  role text not null default 'worker' check (role in ('owner','worker')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  label text,                                 -- "Barra + apertura"
  note text,                                  -- tarea / mensaje del encargado
  created_at timestamptz not null default now(),
  changed_at timestamptz,                     -- última modificación tras crearlo
  check (ends_at > starts_at)
);
create index on public.shifts (business_id, starts_at);
create index on public.shifts (user_id, starts_at);

-- Fichajes: solo se insertan desde funciones del servidor; nadie los edita.
create table public.punches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  shift_id uuid references public.shifts(id) on delete set null,
  kind text not null check (kind in ('in','out')),
  at timestamptz not null default now(),
  source text not null default 'qr' check (source in ('qr','correction')),
  created_at timestamptz not null default now()
);
create index on public.punches (shift_id);
create index on public.punches (user_id, at);

create table public.corrections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  kind text not null check (kind in ('in','out')),
  requested_at timestamptz not null,          -- hora que el trabajador dice que era
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.stock_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  place text,                                 -- "Barra · cajas de 6 L"
  status smallint not null default 0 check (status between 0 and 2), -- 0 hay · 1 queda poco · 2 falta
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  sort int not null default 0
);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

create or replace function public.my_business() returns uuid
language sql stable security definer set search_path = public as $$
  select business_id from profiles where id = auth.uid()
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'owner' from profiles where id = auth.uid()), false)
$$;

-- Registro: el usuario se da de alta con el código del local.
-- La PRIMERA cuenta de cada local queda como encargada (owner); el resto, trabajadores.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b uuid;
  has_owner boolean;
begin
  select id into b from businesses
   where upper(join_code) = upper(coalesce(new.raw_user_meta_data->>'join_code',''));
  if b is null then
    raise exception 'Código de local incorrecto';
  end if;
  select exists(select 1 from profiles where business_id = b and role = 'owner') into has_owner;
  insert into profiles (id, business_id, full_name, role)
  values (new.id, b,
          coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1)),
          case when has_owner then 'worker' else 'owner' end);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Marca los turnos modificados para avisar al trabajador.
create or replace function public.touch_shift() returns trigger
language plpgsql as $$
begin
  if (new.starts_at, new.ends_at, new.user_id, coalesce(new.label,''), coalesce(new.note,''))
     is distinct from (old.starts_at, old.ends_at, old.user_id, coalesce(old.label,''), coalesce(old.note,'')) then
    new.changed_at := now();
  end if;
  return new;
end $$;

create trigger shifts_touch before update on public.shifts
  for each row execute function public.touch_shift();

-- ---------------------------------------------------------------------
-- Fichar con el QR del local. La hora la pone el servidor, no el móvil.
-- ---------------------------------------------------------------------
create or replace function public.fichar(p_code text)
returns table (kind text, at timestamptz, shift_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  me profiles%rowtype;
  biz businesses%rowtype;
  s shifts%rowtype;
  k text;
  last_kind text;
  last_at timestamptz;
begin
  select * into me from profiles where id = auth.uid() and active;
  if me.id is null then raise exception 'No has iniciado sesión'; end if;

  select * into biz from businesses where id = me.business_id;
  if biz.qr_secret is distinct from p_code then
    raise exception 'Este QR no es el de tu local';
  end if;

  -- Turno de hoy más cercano a "ahora" (se admite fichar 2 h antes y hasta 4 h después).
  select * into s from shifts sh
   where sh.user_id = me.id
     and now() between sh.starts_at - interval '2 hours' and sh.ends_at + interval '4 hours'
   order by abs(extract(epoch from (now() - sh.starts_at))) limit 1;

  select p.kind, p.at into last_kind, last_at from punches p
   where p.user_id = me.id
     and (p.shift_id = s.id or (s.id is null and p.at > now() - interval '16 hours'))
   order by p.at desc limit 1;

  -- Doble escaneo accidental (menos de 2 min): no se registra otro fichaje.
  if last_at is not null and now() - last_at < interval '2 minutes' then
    raise exception 'Ya has fichado hace un momento';
  end if;

  k := case when last_kind = 'in' then 'out' else 'in' end;

  insert into punches (business_id, user_id, shift_id, kind, source)
  values (me.business_id, me.id, s.id, k, 'qr');

  return query select k, now(), s.id, s.starts_at, s.ends_at;
end $$;

-- ---------------------------------------------------------------------
-- Bolsa de horas
-- REGLA: solo cuenta el exceso a la SALIDA.
--   extra = max(0, última salida real − fin del turno)
--   Entrar antes NO suma. Entrar tarde tampoco resta (se ve, pero no descuenta).
-- ---------------------------------------------------------------------
create or replace view public.shift_balance
with (security_invoker = true) as
select
  s.id as shift_id,
  s.business_id,
  s.user_id,
  s.starts_at,
  s.ends_at,
  s.label,
  min(p.at) filter (where p.kind = 'in')  as real_in,
  max(p.at) filter (where p.kind = 'out') as real_out,
  case
    when max(p.at) filter (where p.kind = 'out') is null then null
    else greatest(0, floor(extract(epoch from (max(p.at) filter (where p.kind = 'out') - s.ends_at)) / 60))::int
  end as extra_minutes,
  exists (select 1 from corrections c where c.shift_id = s.id and c.status = 'pending') as has_pending_correction
from shifts s
left join punches p on p.shift_id = s.id
group by s.id;

-- ---------------------------------------------------------------------
-- Correcciones (olvidé fichar): las aprueba la encargada.
-- ---------------------------------------------------------------------
create or replace function public.review_correction(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare c corrections%rowtype;
begin
  if not is_owner() then raise exception 'Solo la encargada puede revisar correcciones'; end if;
  select * into c from corrections where id = p_id and business_id = my_business() and status = 'pending';
  if c.id is null then raise exception 'Corrección no encontrada'; end if;

  update corrections set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = c.id;

  if p_approve then
    insert into punches (business_id, user_id, shift_id, kind, at, source)
    values (c.business_id, c.user_id, c.shift_id, c.kind, c.requested_at, 'correction');
  end if;
end $$;

-- Crear / editar turnos con fecha y hora local del negocio.
create or replace function public.save_shift(
  p_id uuid, p_user uuid, p_date date, p_start time, p_end time, p_label text, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  tz text;
  st timestamptz;
  en timestamptz;
  rid uuid;
begin
  if not is_owner() then raise exception 'Solo la encargada puede editar turnos'; end if;
  if not exists (select 1 from profiles where id = p_user and business_id = my_business()) then
    raise exception 'Trabajador no válido';
  end if;
  select timezone into tz from businesses where id = my_business();
  st := (p_date + p_start) at time zone tz;
  en := (p_date + p_end) at time zone tz;
  if en <= st then en := en + interval '1 day'; end if;   -- turnos que cruzan medianoche

  if p_id is null then
    insert into shifts (business_id, user_id, starts_at, ends_at, label, note)
    values (my_business(), p_user, st, en, nullif(p_label,''), nullif(p_note,''))
    returning id into rid;
  else
    update shifts set user_id = p_user, starts_at = st, ends_at = en,
           label = nullif(p_label,''), note = nullif(p_note,'')
     where id = p_id and business_id = my_business()
    returning id into rid;
  end if;
  return rid;
end $$;

-- ---------------------------------------------------------------------
-- Seguridad por filas (RLS)
-- ---------------------------------------------------------------------
alter table public.businesses  enable row level security;
alter table public.profiles    enable row level security;
alter table public.shifts      enable row level security;
alter table public.punches     enable row level security;
alter table public.corrections enable row level security;
alter table public.stock_items enable row level security;

-- Negocio: lo ven sus miembros, pero el secreto del QR y el código de alta NO
-- (si un trabajador pudiera leerlo, podría fichar desde casa). La encargada lo obtiene con get_qr_secret().
create policy biz_read on public.businesses for select using (id = my_business());
revoke select on public.businesses from anon, authenticated;
grant select (id, name, timezone, created_at) on public.businesses to authenticated;

create or replace function public.get_admin_codes() returns table (qr_secret text, join_code text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'Solo la encargada'; end if;
  return query select b.qr_secret, b.join_code from businesses b where b.id = my_business();
end $$;
revoke all on function public.get_admin_codes() from public, anon;
grant execute on function public.get_admin_codes() to authenticated;

-- Cambiar el QR (por ejemplo si alguien se lo ha llevado en una foto).
create or replace function public.rotate_qr_secret() returns text
language plpgsql security definer set search_path = public as $$
declare v text := encode(gen_random_bytes(16), 'hex');
begin
  if not is_owner() then raise exception 'Solo la encargada'; end if;
  update businesses set qr_secret = v where id = my_business();
  return v;
end $$;
revoke all on function public.rotate_qr_secret() from public, anon;
grant execute on function public.rotate_qr_secret() to authenticated;

create policy prof_read on public.profiles for select using (business_id = my_business());
create policy prof_owner_update on public.profiles for update
  using (business_id = my_business() and is_owner())
  with check (business_id = my_business());

-- Turnos: todos los del local los ven (cuadrante); solo la encargada los borra (crear/editar va por save_shift).
create policy shifts_read on public.shifts for select using (business_id = my_business());
create policy shifts_owner_delete on public.shifts for delete using (business_id = my_business() and is_owner());

-- Fichajes: cada uno ve los suyos; la encargada ve todos. Sin insert/update/delete directos.
create policy punches_read on public.punches for select
  using (business_id = my_business() and (user_id = auth.uid() or is_owner()));

-- Correcciones
create policy corr_read on public.corrections for select
  using (business_id = my_business() and (user_id = auth.uid() or is_owner()));
create policy corr_insert on public.corrections for insert
  with check (business_id = my_business() and user_id = auth.uid() and status = 'pending'
              and exists (select 1 from shifts s where s.id = shift_id and s.user_id = auth.uid()));

-- Reposición: todos ven y cambian el estado; la encargada añade y borra.
create policy stock_read on public.stock_items for select using (business_id = my_business());
create policy stock_update on public.stock_items for update
  using (business_id = my_business()) with check (business_id = my_business());
create policy stock_insert on public.stock_items for insert
  with check (business_id = my_business() and is_owner());
create policy stock_delete on public.stock_items for delete
  using (business_id = my_business() and is_owner());

-- Solo funciones expuestas a usuarios con sesión
revoke all on function public.fichar(text) from public, anon;
grant execute on function public.fichar(text) to authenticated;
revoke all on function public.review_correction(uuid, boolean) from public, anon;
grant execute on function public.review_correction(uuid, boolean) to authenticated;
revoke all on function public.save_shift(uuid, uuid, date, time, time, text, text) from public, anon;
grant execute on function public.save_shift(uuid, uuid, date, time, time, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Datos iniciales: el local. Cambia el código si quieres.
-- ---------------------------------------------------------------------
insert into public.businesses (name, join_code) values ('Método Café', 'METODO2026');

insert into public.stock_items (business_id, name, place, sort)
select id, x.name, x.place, x.sort from public.businesses,
  (values ('Leche entera','Barra · cajas de 6 L',1),
          ('Bebida de avena barista','Barra · cajas de 6 L',2),
          ('Café de espresso','Tolva · bolsas 1 kg',3),
          ('Vasos 8 oz para llevar','Almacén · mangas de 50',4),
          ('Tapas vasos 8 oz','Almacén · mangas de 100',5),
          ('Sobres de azúcar','Sala · caja',6)) as x(name, place, sort)
where join_code = 'METODO2026';
