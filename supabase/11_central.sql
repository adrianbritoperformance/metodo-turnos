-- =====================================================================
-- Método Café · Actualización 11: panel central (administrador de la plataforma)
--   · Ve todas las cuentas de todos los locales: nombre, correo, puesto y vista.
--   · Cambia la vista (Admin / Equipo), el puesto y el alta/baja de cada cuenta.
--   · Da de alta locales nuevos (para vender la app a otras cafeterías).
-- Ejecutar entero en Supabase → SQL Editor (una vez), DESPUÉS de 10_ausencias_privadas.sql.
--
-- La cuenta del panel central es la de adrianbritot@gmail.com (abajo).
-- =====================================================================

-- Quién administra la plataforma (no depende de ningún local).
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
-- Nadie la lee ni la escribe directamente: solo a través de las funciones de abajo.

-- Puesto de cada persona (Dueño/a, Barista, Jefe/a de cocina…). Es solo una etiqueta.
alter table public.profiles add column if not exists job_title text;
grant select (job_title) on public.profiles to authenticated;

create or replace function public.is_superadmin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
$$;
revoke all on function public.is_superadmin() from public, anon;
grant execute on function public.is_superadmin() to authenticated;

-- Todas las cuentas, con su correo (el correo solo lo ve el panel central).
create or replace function public.sa_list_accounts()
returns table (user_id uuid, email text, full_name text, role text, job_title text, active boolean,
               business_id uuid, business_name text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not is_superadmin() then raise exception 'Solo el administrador central'; end if;
  return query
    select p.id, u.email::text, p.full_name, p.role, p.job_title, p.active,
           b.id, b.name, p.created_at, u.last_sign_in_at
      from profiles p
      join auth.users u on u.id = p.id
      join businesses b on b.id = p.business_id
     order by b.name, p.role desc, p.full_name;
end $$;
revoke all on function public.sa_list_accounts() from public, anon;
grant execute on function public.sa_list_accounts() to authenticated;

create or replace function public.sa_set_account(p_user uuid, p_role text, p_job_title text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_superadmin() then raise exception 'Solo el administrador central'; end if;
  if p_role not in ('owner', 'worker') then raise exception 'Vista no válida'; end if;
  update profiles set role = p_role, job_title = nullif(trim(p_job_title), ''), active = p_active
   where id = p_user;
end $$;
revoke all on function public.sa_set_account(uuid, text, text, boolean) from public, anon;
grant execute on function public.sa_set_account(uuid, text, text, boolean) to authenticated;

-- Locales: listar y crear (cada local tiene su código de alta).
create or replace function public.sa_list_businesses()
returns table (id uuid, name text, join_code text, accounts int, owners int, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_superadmin() then raise exception 'Solo el administrador central'; end if;
  return query
    select b.id, b.name, b.join_code,
           (select count(*)::int from profiles p where p.business_id = b.id),
           (select count(*)::int from profiles p where p.business_id = b.id and p.role = 'owner'),
           b.created_at
      from businesses b order by b.created_at;
end $$;
revoke all on function public.sa_list_businesses() from public, anon;
grant execute on function public.sa_list_businesses() to authenticated;

create or replace function public.sa_create_business(p_name text, p_join_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid;
begin
  if not is_superadmin() then raise exception 'Solo el administrador central'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_join_code), '') = '' then raise exception 'Faltan datos'; end if;
  if exists (select 1 from businesses where upper(join_code) = upper(trim(p_join_code))) then
    raise exception 'Ese código ya existe';
  end if;
  insert into businesses (name, join_code) values (trim(p_name), upper(trim(p_join_code))) returning id into bid;
  -- Mismo horario tipo de partida que Método (se cambia luego desde Gestión del local).
  insert into shift_templates (business_id, name, start_time, end_time, weekdays, sort)
  values (bid, 'Mañana', '08:30', '13:30', '{1,2,3,4,5}', 1),
         (bid, 'Mañana', '09:30', '13:30', '{6}', 2),
         (bid, 'Tarde',  '16:00', '20:00', '{1,2,3,4,5}', 3),
         (bid, 'Tarde',  '16:00', '20:30', '{6,7}', 4);
  return bid;
end $$;
revoke all on function public.sa_create_business(text, text) from public, anon;
grant execute on function public.sa_create_business(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Adrián como administrador central.
-- ---------------------------------------------------------------------
insert into public.platform_admins (user_id)
select id from auth.users where lower(email) = lower('adrianbritot@gmail.com')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Contraseña temporal: el administrador central puede poner una contraseña
-- a cualquier cuenta (por si alguien la olvida y el correo no le llega).
-- La persona entra con ella y la cambia en "Mi perfil".
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

create or replace function public.sa_set_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if not is_superadmin() then raise exception 'Solo el administrador central'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'Mínimo 6 caracteres'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now()
   where id = p_user;
end $$;
revoke all on function public.sa_set_password(uuid, text) from public, anon;
grant execute on function public.sa_set_password(uuid, text) to authenticated;
