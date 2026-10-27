-- =====================================================================
-- Método Café · Actualización 3: planificador con turnos de mañana y tarde
-- Ejecutar entero en Supabase → SQL Editor (una vez), DESPUÉS de 02_contrato.sql.
-- =====================================================================

-- Horario tipo del local (se cambia en Gestión).
alter table public.businesses
  add column if not exists morning_start time not null default '08:30',
  add column if not exists morning_end time not null default '13:30',
  add column if not exists afternoon_start time not null default '15:30',
  add column if not exists afternoon_end time not null default '20:30';
grant select (morning_start, morning_end, afternoon_start, afternoon_end) on public.businesses to authenticated;

-- Cada turno puede ser de mañana (M) o de tarde (T); los turnos sueltos quedan sin franja.
alter table public.shifts add column if not exists slot text check (slot in ('M','T'));

create or replace function public.save_templates(p_ms time, p_me time, p_as time, p_ae time)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'Solo la encargada'; end if;
  if p_me <= p_ms or p_ae <= p_as then raise exception 'Revisa las horas'; end if;
  update businesses set morning_start = p_ms, morning_end = p_me, afternoon_start = p_as, afternoon_end = p_ae
   where id = my_business();
end $$;

-- Poner / quitar el turno de mañana o tarde de una persona en un día.
-- Devuelve 'added' o 'removed'. No borra un turno que ya tenga fichajes.
create or replace function public.toggle_shift(p_user uuid, p_date date, p_slot text)
returns text language plpgsql security definer set search_path = public as $$
declare
  biz businesses%rowtype;
  existing uuid;
  st time; en time;
begin
  if not is_owner() then raise exception 'Solo la encargada puede planificar'; end if;
  if p_slot not in ('M','T') then raise exception 'Franja no válida'; end if;
  select * into biz from businesses where id = my_business();
  if not exists (select 1 from profiles where id = p_user and business_id = biz.id) then
    raise exception 'Trabajador no válido';
  end if;

  select s.id into existing from shifts s
   where s.user_id = p_user and s.slot = p_slot
     and (s.starts_at at time zone biz.timezone)::date = p_date
   limit 1;

  if existing is not null then
    if exists (select 1 from punches where shift_id = existing) then
      raise exception 'Ese turno ya tiene fichajes: edítalo en vez de quitarlo';
    end if;
    delete from shifts where id = existing;
    return 'removed';
  end if;

  if p_slot = 'M' then st := biz.morning_start; en := biz.morning_end;
  else st := biz.afternoon_start; en := biz.afternoon_end; end if;

  insert into shifts (business_id, user_id, starts_at, ends_at, label, slot)
  values (biz.id, p_user,
          (p_date + st) at time zone biz.timezone,
          (p_date + en) at time zone biz.timezone,
          case when p_slot = 'M' then 'Mañana' else 'Tarde' end,
          p_slot);
  return 'added';
end $$;

-- Copiar todos los turnos de una semana (lunes p_from) a otra (lunes p_to).
-- Respeta horas modificadas; no duplica lo que ya exista; no copia las tareas.
create or replace function public.copy_week(p_from date, p_to date)
returns int language plpgsql security definer set search_path = public as $$
declare
  biz businesses%rowtype;
  n int;
begin
  if not is_owner() then raise exception 'Solo la encargada'; end if;
  select * into biz from businesses where id = my_business();
  with src as (
    select s.*, ((s.starts_at at time zone biz.timezone)::date - p_from) as d
      from shifts s
     where s.business_id = biz.id
       and s.starts_at >= (p_from::timestamp at time zone biz.timezone)
       and s.starts_at <  ((p_from + 7)::timestamp at time zone biz.timezone)
  ), ins as (
    insert into shifts (business_id, user_id, starts_at, ends_at, label, slot)
    select biz.id, src.user_id,
           ((p_to + src.d) + (src.starts_at at time zone biz.timezone)::time) at time zone biz.timezone,
           ((p_to + src.d) + (src.starts_at at time zone biz.timezone)::time) at time zone biz.timezone + (src.ends_at - src.starts_at),
           src.label, src.slot
      from src
      join profiles p on p.id = src.user_id and p.active
     where not exists (
       select 1 from shifts t
        where t.user_id = src.user_id
          and (t.starts_at at time zone biz.timezone)::date = p_to + src.d
          and coalesce(t.slot, '') = coalesce(src.slot, '')
          and (src.slot is not null or (t.starts_at at time zone biz.timezone)::time = (src.starts_at at time zone biz.timezone)::time)
     )
    returning 1
  )
  select count(*) into n from ins;
  return n;
end $$;

revoke all on function public.save_templates(time, time, time, time) from public, anon;
grant execute on function public.save_templates(time, time, time, time) to authenticated;
revoke all on function public.toggle_shift(uuid, date, text) from public, anon;
grant execute on function public.toggle_shift(uuid, date, text) to authenticated;
revoke all on function public.copy_week(date, date) from public, anon;
grant execute on function public.copy_week(date, date) to authenticated;

-- Los turnos ya creados a mano con las horas exactas del horario tipo pasan a ser de mañana/tarde.
update public.shifts s set slot = 'M'
  from public.businesses b
 where b.id = s.business_id and s.slot is null
   and (s.starts_at at time zone b.timezone)::time = b.morning_start
   and (s.ends_at at time zone b.timezone)::time = b.morning_end;
update public.shifts s set slot = 'T'
  from public.businesses b
 where b.id = s.business_id and s.slot is null
   and (s.starts_at at time zone b.timezone)::time = b.afternoon_start
   and (s.ends_at at time zone b.timezone)::time = b.afternoon_end;
