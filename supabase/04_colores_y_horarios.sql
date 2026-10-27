-- =====================================================================
-- Método Café · Actualización 4
--   · Horarios distintos entre semana, sábado y domingo
--   · Color de cada persona (lo elige en su perfil)
--   · Borrar una semana entera del cuadrante
-- Ejecutar entero en Supabase → SQL Editor (una vez), DESPUÉS de 03_plantillas.sql
-- y justo antes de 05_control.sql (que añade los fichajes anulados que se usan aquí).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Turnos tipo por día de la semana (1 = lunes … 7 = domingo)
--    L–V:  Mañana 8:30–13:30 · Tarde 16:00–20:00
--    Sáb:  Mañana 9:30–13:30 · Tarde 16:00–20:30
--    Dom:                      Tarde 16:00–20:30
-- ---------------------------------------------------------------------
alter table public.shift_templates
  add column if not exists weekdays smallint[] not null default '{1,2,3,4,5,6,7}';

do $$
declare
  b record;
  m_id uuid;
  t_id uuid;
  m_sat uuid;
  t_we uuid;
begin
  for b in select id from public.businesses loop
    -- Solo se reorganiza si todavía están los dos turnos de "todos los días"
    if exists (select 1 from shift_templates where business_id = b.id and weekdays <> '{1,2,3,4,5,6,7}') then
      continue;
    end if;
    select id into m_id from shift_templates where business_id = b.id and name = 'Mañana' order by sort limit 1;
    select id into t_id from shift_templates where business_id = b.id and name = 'Tarde'  order by sort limit 1;
    if m_id is null or t_id is null then continue; end if;

    update shift_templates set weekdays = '{1,2,3,4,5}', start_time = '08:30', end_time = '13:30', sort = 1 where id = m_id;
    update shift_templates set weekdays = '{1,2,3,4,5}', start_time = '16:00', end_time = '20:00', sort = 3 where id = t_id;
    insert into shift_templates (business_id, name, start_time, end_time, weekdays, sort)
      values (b.id, 'Mañana', '09:30', '13:30', '{6}', 2) returning id into m_sat;
    insert into shift_templates (business_id, name, start_time, end_time, weekdays, sort)
      values (b.id, 'Tarde', '16:00', '20:30', '{6,7}', 4) returning id into t_we;

    -- Los turnos ya puestos en fin de semana pasan a su turno tipo de fin de semana
    -- (conservan sus horas; si eran distintas, se verán en amarillo para revisarlas).
    update shifts set template_id = m_sat
     where template_id = m_id and extract(isodow from starts_at at time zone 'Europe/Madrid') in (6, 7);
    update shifts set template_id = t_we
     where template_id = t_id and extract(isodow from starts_at at time zone 'Europe/Madrid') in (6, 7);
  end loop;
end $$;

create or replace function public.toggle_template_shift(p_user uuid, p_date date, p_template uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  t shift_templates%rowtype;
  tz text;
  st timestamptz;
  en timestamptz;
  existing uuid;
begin
  if not is_owner() then raise exception 'Solo la encargada puede editar turnos'; end if;
  select * into t from shift_templates where id = p_template and business_id = my_business();
  if t.id is null then raise exception 'Turno tipo no válido'; end if;
  if not exists (select 1 from profiles where id = p_user and business_id = my_business()) then
    raise exception 'Trabajador no válido';
  end if;
  select timezone into tz from businesses where id = my_business();

  select id into existing from shifts
   where user_id = p_user and template_id = p_template
     and (starts_at at time zone tz)::date = p_date
   limit 1;

  if p_on then
    if existing is not null then return; end if;
    if not (extract(isodow from p_date)::smallint = any (t.weekdays)) then
      raise exception 'Ese turno no existe ese día de la semana';
    end if;
    st := (p_date + t.start_time) at time zone tz;
    en := (p_date + t.end_time) at time zone tz;
    if en <= st then en := en + interval '1 day'; end if;
    insert into shifts (business_id, user_id, starts_at, ends_at, label, template_id)
    values (my_business(), p_user, st, en, null, t.id);
  else
    if existing is null then return; end if;
    if exists (select 1 from punches where shift_id = existing and voided_at is null) then
      raise exception 'Ese turno ya tiene fichajes y no se puede quitar';
    end if;
    delete from shifts where id = existing;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Color de cada persona (visible para todo el equipo en el calendario)
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
grant select (color) on public.profiles to authenticated;

create or replace function public.set_my_color(p_color text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_color is not null and p_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Color no válido'; end if;
  update profiles set color = p_color where id = auth.uid();
end $$;
revoke all on function public.set_my_color(text) from public, anon;
grant execute on function public.set_my_color(text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Borrar una semana del cuadrante (lunes p_monday … domingo).
--    No borra turnos que ya tienen fichajes: los cuenta como "conservados".
-- ---------------------------------------------------------------------
create or replace function public.clear_week(p_monday date)
returns table (deleted int, kept int)
language plpgsql security definer set search_path = public as $$
declare
  tz text;
  d int;
  k int;
begin
  if not is_owner() then raise exception 'Solo la encargada puede editar turnos'; end if;
  select timezone into tz from businesses where id = my_business();

  select count(*) into k from shifts s
   where s.business_id = my_business()
     and (s.starts_at at time zone tz)::date between p_monday and p_monday + 6
     and exists (select 1 from punches p where p.shift_id = s.id and p.voided_at is null);

  with del as (
    delete from shifts s
     where s.business_id = my_business()
       and (s.starts_at at time zone tz)::date between p_monday and p_monday + 6
       and not exists (select 1 from punches p where p.shift_id = s.id and p.voided_at is null)
    returning 1
  ) select count(*) into d from del;

  return query select d, k;
end $$;
revoke all on function public.clear_week(date) from public, anon;
grant execute on function public.clear_week(date) to authenticated;
