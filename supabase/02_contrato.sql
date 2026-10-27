-- =====================================================================
-- Método Café · Actualización 2: horas de contrato y saldo semanal
-- Ejecutar entero en Supabase → SQL Editor (una vez), DESPUÉS de schema.sql.
-- =====================================================================

-- Horas semanales de contrato de cada persona (por defecto 40).
alter table public.profiles
  add column if not exists weekly_hours numeric(4,1) not null default 40
  check (weekly_hours >= 0 and weekly_hours <= 60);

-- Las horas de contrato son privadas: cada uno ve las suyas y la encargada las de todos.
revoke select on public.profiles from anon, authenticated;
grant select (id, business_id, full_name, role, active, created_at) on public.profiles to authenticated;
revoke update on public.profiles from anon, authenticated;
grant update (role, active, weekly_hours) on public.profiles to authenticated;

create or replace function public.get_contracts()
returns table (user_id uuid, full_name text, weekly_hours numeric, role text, active boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.weekly_hours, p.role, p.active
    from profiles p
   where p.business_id = my_business()
     and (p.id = auth.uid() or is_owner())
   order by p.full_name
$$;
revoke all on function public.get_contracts() from public, anon;
grant execute on function public.get_contracts() to authenticated;

-- Duración prevista de cada turno, añadida a la vista de turnos.
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
  exists (select 1 from corrections c where c.shift_id = s.id and c.status = 'pending') as has_pending_correction,
  (extract(epoch from (s.ends_at - s.starts_at)) / 60)::int as planned_minutes
from shifts s
left join punches p on p.shift_id = s.id
group by s.id;

-- ---------------------------------------------------------------------
-- Saldo semanal frente al contrato (semana de lunes a domingo, hora del local).
--   horas hechas de un turno = duración prevista + minutos de salida tarde
--   saldo = horas hechas − horas de contrato  (positivo suma, negativo resta)
--   Las semanas sin ningún turno no cuentan (vacaciones, días libres de semana completa).
--   Solo se da por cerrada una semana cuando ha terminado.
-- Visible para la propia persona y para la encargada.
-- ---------------------------------------------------------------------
create or replace view public.week_balance as
with t as (
  select
    sb.user_id,
    sb.business_id,
    date_trunc('week', sb.starts_at at time zone b.timezone)::date as week_start,
    sb.planned_minutes,
    coalesce(sb.extra_minutes, 0) as extra_minutes,
    (sb.real_out is null and sb.ends_at < now()) as missing_out
  from shift_balance sb
  join businesses b on b.id = sb.business_id
)
select
  t.user_id,
  t.business_id,
  t.week_start,
  count(*)::int as shifts,
  sum(t.planned_minutes)::int as planned_minutes,
  sum(t.extra_minutes)::int as extra_minutes,
  (sum(t.planned_minutes) + sum(t.extra_minutes))::int as worked_minutes,
  (p.weekly_hours * 60)::int as contract_minutes,
  (sum(t.planned_minutes) + sum(t.extra_minutes) - p.weekly_hours * 60)::int as balance_minutes,
  bool_or(t.missing_out) as has_missing_out,
  ((t.week_start + 7)::timestamp at time zone b.timezone) <= now() as closed
from t
join profiles p on p.id = t.user_id
join businesses b on b.id = t.business_id
where t.business_id = public.my_business()
  and (t.user_id = auth.uid() or public.is_owner())
group by t.user_id, t.business_id, t.week_start, p.weekly_hours, b.timezone;

grant select on public.week_balance to authenticated;
revoke all on public.week_balance from anon;
