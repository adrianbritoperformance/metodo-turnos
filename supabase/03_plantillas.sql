-- =====================================================================
-- Método Café · Actualización 3: turnos de Mañana / Tarde con un toque
-- Ejecutar entero en Supabase → SQL Editor (una vez), DESPUÉS de 02_contrato.sql.
-- =====================================================================

-- Turnos tipo del local (Mañana, Tarde). Sus horas se cambian en Gestión.
create table if not exists public.shift_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  start_time time not null,
  end_time time not null,
  sort int not null default 0
);
alter table public.shift_templates enable row level security;
create policy tpl_read on public.shift_templates for select using (business_id = my_business());
create policy tpl_owner_update on public.shift_templates for update
  using (business_id = my_business() and is_owner()) with check (business_id = my_business());

insert into public.shift_templates (business_id, name, start_time, end_time, sort)
select b.id, x.name, x.st, x.en, x.sort from public.businesses b,
  (values ('Mañana', time '08:30', time '13:30', 1),
          ('Tarde',  time '15:30', time '20:30', 2)) as x(name, st, en, sort)
where not exists (select 1 from public.shift_templates t where t.business_id = b.id);

-- Cada turno recuerda de qué turno tipo sale (si sale de alguno).
alter table public.shifts add column if not exists template_id uuid references public.shift_templates(id) on delete set null;

-- Poner o quitar el turno tipo de una persona en un día (un toque en el calendario).
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
    st := (p_date + t.start_time) at time zone tz;
    en := (p_date + t.end_time) at time zone tz;
    if en <= st then en := en + interval '1 day'; end if;
    insert into shifts (business_id, user_id, starts_at, ends_at, label, template_id)
    values (my_business(), p_user, st, en, null, t.id);
  else
    if existing is null then return; end if;
    if exists (select 1 from punches where shift_id = existing) then
      raise exception 'Ese turno ya tiene fichajes y no se puede quitar';
    end if;
    delete from shifts where id = existing;
  end if;
end $$;
revoke all on function public.toggle_template_shift(uuid, date, uuid, boolean) from public, anon;
grant execute on function public.toggle_template_shift(uuid, date, uuid, boolean) to authenticated;

-- Copiar todos los turnos de una semana (lunes p_from) a otra (lunes p_to), con las mismas horas.
-- No duplica: si esa persona ya tiene ese mismo turno tipo ese día, lo salta.
create or replace function public.copy_week(p_from date, p_to date)
returns int language plpgsql security definer set search_path = public as $$
declare
  tz text;
  n int := 0;
  r record;
  d int := p_to - p_from;
begin
  if not is_owner() then raise exception 'Solo la encargada puede editar turnos'; end if;
  select timezone into tz from businesses where id = my_business();
  for r in
    select s.* from shifts s
     where s.business_id = my_business()
       and (s.starts_at at time zone tz)::date >= p_from
       and (s.starts_at at time zone tz)::date <  p_from + 7
       and exists (select 1 from profiles p where p.id = s.user_id and p.active)
  loop
    if r.template_id is not null and exists (
         select 1 from shifts x where x.user_id = r.user_id and x.template_id = r.template_id
            and (x.starts_at at time zone tz)::date = (r.starts_at at time zone tz)::date + d) then
      continue;
    end if;
    if r.template_id is null and exists (
         select 1 from shifts x where x.user_id = r.user_id
            and x.starts_at = ((r.starts_at at time zone tz) + make_interval(days => d)) at time zone tz) then
      continue;
    end if;
    insert into shifts (business_id, user_id, starts_at, ends_at, label, note, template_id)
    values (r.business_id, r.user_id,
            ((r.starts_at at time zone tz) + make_interval(days => d)) at time zone tz,
            ((r.ends_at   at time zone tz) + make_interval(days => d)) at time zone tz,
            r.label, null, r.template_id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.copy_week(date, date) from public, anon;
grant execute on function public.copy_week(date, date) to authenticated;
