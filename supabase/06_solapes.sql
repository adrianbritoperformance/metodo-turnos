-- =====================================================================
-- Método Café · Actualización 6: una persona no puede tener dos turnos que se pisen
-- Ejecutar entero en Supabase → SQL Editor (una vez), DESPUÉS de 05_control.sql.
-- (Los turnos repetidos que ya existan no se tocan: se ven en el cuadrante y se quitan a mano.)
-- =====================================================================

create or replace function public.no_overlap() returns trigger
language plpgsql as $$
begin
  if exists (
    select 1 from shifts x
     where x.user_id = new.user_id and x.id <> new.id
       and x.starts_at < new.ends_at and new.starts_at < x.ends_at
  ) then
    raise exception 'Esa persona ya tiene un turno que se solapa con este';
  end if;
  return new;
end $$;

drop trigger if exists shifts_no_overlap on public.shifts;
create trigger shifts_no_overlap before insert or update of starts_at, ends_at, user_id on public.shifts
  for each row execute function public.no_overlap();

-- Copiar semana: salta lo que se solaparía en vez de fallar.
create or replace function public.copy_week(p_from date, p_to date)
returns int language plpgsql security definer set search_path = public as $$
declare
  tz text;
  n int := 0;
  r record;
  d int := p_to - p_from;
  ns timestamptz;
  ne timestamptz;
begin
  if not is_owner() then raise exception 'Solo la encargada puede editar turnos'; end if;
  select timezone into tz from businesses where id = my_business();
  for r in
    select s.* from shifts s
     where s.business_id = my_business()
       and (s.starts_at at time zone tz)::date >= p_from
       and (s.starts_at at time zone tz)::date <  p_from + 7
       and exists (select 1 from profiles p where p.id = s.user_id and p.active)
     order by s.starts_at
  loop
    ns := ((r.starts_at at time zone tz) + make_interval(days => d)) at time zone tz;
    ne := ((r.ends_at   at time zone tz) + make_interval(days => d)) at time zone tz;
    if exists (select 1 from shifts x where x.user_id = r.user_id and x.starts_at < ne and ns < x.ends_at) then
      continue;
    end if;
    insert into shifts (business_id, user_id, starts_at, ends_at, label, note, template_id)
    values (r.business_id, r.user_id, ns, ne, r.label, null, r.template_id);
    n := n + 1;
  end loop;
  return n;
end $$;
