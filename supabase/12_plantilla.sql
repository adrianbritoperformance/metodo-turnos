-- =====================================================================
-- Método Café · Actualización 12: plantilla semanal por persona
--   · Poner, cambiar las horas o quitar la Mañana / Tarde de un día a una persona.
--   · Horario habitual de cada persona, para rellenar la semana de un toque.
--   · Enlaza a Mañana / Tarde los turnos sueltos puestos con versiones anteriores.
-- Ejecutar entero en Supabase → SQL Editor (una vez), DESPUÉS de 11_central.sql.
-- =====================================================================

create or replace function public.set_slot(
  p_user uuid, p_date date, p_template uuid, p_on boolean, p_start time, p_end time)
returns text language plpgsql security definer set search_path = public as $$
declare
  t shift_templates%rowtype;
  tz text;
  st timestamptz;
  en timestamptz;
  existing shifts%rowtype;
begin
  if not is_owner() then raise exception 'Solo los admins pueden editar turnos'; end if;
  select * into t from shift_templates where id = p_template and business_id = my_business();
  if t.id is null then raise exception 'Turno tipo no válido'; end if;
  if not exists (select 1 from profiles where id = p_user and business_id = my_business()) then
    raise exception 'Trabajador no válido';
  end if;
  select timezone into tz from businesses where id = my_business();

  select * into existing from shifts
   where user_id = p_user and template_id = p_template and (starts_at at time zone tz)::date = p_date
   limit 1;
  -- Si ese día hay un turno suelto (sin Mañana/Tarde) en la misma franja, se usa ese.
  if existing.id is null then
    select * into existing from shifts
     where user_id = p_user and template_id is null and (starts_at at time zone tz)::date = p_date
       and ((extract(hour from starts_at at time zone tz) < 14) = (t.start_time < time '14:00'))
     order by starts_at limit 1;
    if existing.id is not null then update shifts set template_id = t.id where id = existing.id; end if;
  end if;

  if not p_on then
    if existing.id is null then return 'sin cambios'; end if;
    delete from shifts where id = existing.id;          -- los triggers impiden borrar uno ya fichado y terminado
    return 'quitado';
  end if;

  if not (extract(isodow from p_date)::smallint = any (t.weekdays)) then
    raise exception 'Ese turno no existe ese día de la semana';
  end if;
  st := (p_date + coalesce(p_start, t.start_time)) at time zone tz;
  en := (p_date + coalesce(p_end, t.end_time)) at time zone tz;
  if en <= st then en := en + interval '1 day'; end if;

  if existing.id is null then
    insert into shifts (business_id, user_id, starts_at, ends_at, template_id)
    values (my_business(), p_user, st, en, t.id);
    return 'puesto';
  elsif (existing.starts_at, existing.ends_at) is distinct from (st, en) then
    update shifts set starts_at = st, ends_at = en where id = existing.id;
    return 'cambiado';
  end if;
  return 'sin cambios';
end $$;
revoke all on function public.set_slot(uuid, date, uuid, boolean, time, time) from public, anon;
grant execute on function public.set_slot(uuid, date, uuid, boolean, time, time) to authenticated;

-- ---------------------------------------------------------------------
-- Turnos sueltos de versiones anteriores → se enlazan a su Mañana / Tarde
-- (según el día de la semana y si empiezan antes o después de las 14:00).
-- ---------------------------------------------------------------------
update shifts s set template_id = t.id
  from businesses b, shift_templates t
 where s.template_id is null
   and b.id = s.business_id
   and t.business_id = s.business_id
   and extract(isodow from s.starts_at at time zone b.timezone)::smallint = any (t.weekdays)
   and ((extract(hour from s.starts_at at time zone b.timezone) < 14) = (t.start_time < time '14:00'))
   and not exists (
     select 1 from shifts x
      where x.user_id = s.user_id and x.template_id = t.id and x.id <> s.id
        and (x.starts_at at time zone b.timezone)::date = (s.starts_at at time zone b.timezone)::date);

-- ---------------------------------------------------------------------
-- Horario habitual de cada persona (lo editan los admins en Plantilla)
-- ---------------------------------------------------------------------
create table if not exists public.usual_slots (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  template_id uuid not null references public.shift_templates(id) on delete cascade,
  start_time time not null,
  end_time time not null,
  primary key (user_id, weekday, template_id)
);
alter table public.usual_slots enable row level security;
create policy usual_read on public.usual_slots for select using (business_id = my_business() and is_owner());
create policy usual_write on public.usual_slots for all
  using (business_id = my_business() and is_owner())
  with check (business_id = my_business() and is_owner()
              and exists (select 1 from profiles p where p.id = user_id and p.business_id = my_business()));
