-- =====================================================================
-- Método Café · Actualización 5: control horario completo
--   · Periodo de nómina (por defecto del 26 al 25) y saldo del periodo
--   · Cierre de nómina: horas pagadas, lo que queda se arrastra; la trabajadora da su conformidad
--   · Saldo inicial acordado
--   · Historial de cambios de turnos, visible para cada trabajadora
--   · Turnos ya fichados y terminados: no se pueden recortar ni borrar
--   · Fichajes sin turno → la encargada los convierte en turno
-- Ejecutar entero en Supabase → SQL Editor (una vez), DESPUÉS de 04_colores_y_horarios.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Día de corte de la nómina
-- ---------------------------------------------------------------------
alter table public.businesses
  add column if not exists pay_start_day smallint not null default 26 check (pay_start_day between 1 and 28);
grant select (pay_start_day) on public.businesses to authenticated;

create or replace function public.set_pay_start_day(p_day smallint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'Solo la encargada'; end if;
  update businesses set pay_start_day = p_day where id = my_business();
end $$;
revoke all on function public.set_pay_start_day(smallint) from public, anon;
grant execute on function public.set_pay_start_day(smallint) to authenticated;

-- Periodo de la nómina de un mes (p_month = día 1 de ese mes).
-- Con corte 26: nómina de noviembre = 26 oct … 25 nov. Con corte 1: el mes natural.
create or replace function public.pay_period(p_month date, p_start smallint)
returns table (start_date date, end_date date)
language sql immutable as $$
  select
    case when p_start = 1 then date_trunc('month', p_month)::date
         else (date_trunc('month', p_month) - interval '1 month')::date + (p_start - 1) end,
    case when p_start = 1 then (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date
         else date_trunc('month', p_month)::date + (p_start - 2) end
$$;

-- ---------------------------------------------------------------------
-- 2. Saldo de un periodo de nómina
--   horas hechas = Σ (duración prevista + minutos de salida tarde) de los turnos del periodo
--   contrato     = por cada semana con algún turno: horas semanales × días de esa semana dentro del periodo / 7
--   (las semanas sin ningún turno, como vacaciones, no cuentan)
-- ---------------------------------------------------------------------
create or replace function public.period_balance(p_user uuid, p_month date)
returns table (start_date date, end_date date, worked_minutes int, contract_minutes int, balance_minutes int)
language plpgsql stable security definer set search_path = public as $$
declare
  b businesses%rowtype;
  p profiles%rowtype;
  s date;
  e date;
  w int;
  c numeric := 0;
  wk date;
begin
  select * into p from profiles where id = p_user and business_id = my_business();
  if p.id is null or (p_user <> auth.uid() and not is_owner()) then raise exception 'Sin acceso'; end if;
  select * into b from businesses where id = p.business_id;
  select pp.start_date, pp.end_date into s, e from pay_period(p_month, b.pay_start_day) pp;

  select coalesce(sum(sb.planned_minutes + coalesce(sb.extra_minutes, 0)), 0)::int into w
    from shift_balance sb
   where sb.user_id = p_user and (sb.starts_at at time zone b.timezone)::date between s and e;

  for wk in select generate_series(date_trunc('week', s)::date, date_trunc('week', e)::date, interval '7 days')::date loop
    if exists (select 1 from shifts x where x.user_id = p_user
                and (x.starts_at at time zone b.timezone)::date between wk and wk + 6) then
      c := c + p.weekly_hours * 60 * (least(wk + 6, e) - greatest(wk, s) + 1) / 7.0;
    end if;
  end loop;

  return query select s, e, w, round(c)::int, (w - round(c))::int;
end $$;
revoke all on function public.period_balance(uuid, date) from public, anon;
grant execute on function public.period_balance(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Saldo inicial acordado (punto de partida antes de usar la app)
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists opening_minutes int not null default 0;
alter table public.profiles add column if not exists opening_note text;

drop function if exists public.get_contracts();
create function public.get_contracts()
returns table (user_id uuid, full_name text, weekly_hours numeric, role text, active boolean,
               opening_minutes int, opening_note text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.weekly_hours, p.role, p.active, p.opening_minutes, p.opening_note
    from profiles p
   where p.business_id = my_business()
     and (p.id = auth.uid() or is_owner())
   order by p.full_name
$$;
revoke all on function public.get_contracts() from public, anon;
grant execute on function public.get_contracts() to authenticated;

-- ---------------------------------------------------------------------
-- 4. Cierres de nómina
-- ---------------------------------------------------------------------
create table if not exists public.pay_closings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  period_month date not null,             -- día 1 del mes de la nómina
  start_date date not null,
  end_date date not null,
  carried_in int not null,                -- saldo que venía de antes
  worked_minutes int not null,
  contract_minutes int not null,
  balance_minutes int not null,           -- saldo del periodo
  paid_minutes int not null check (paid_minutes >= 0),  -- pagadas en nómina
  carried_out int not null,               -- queda para compensar (pasa al siguiente)
  note text,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz not null default now(),
  worker_status text not null default 'pending' check (worker_status in ('pending','agree','disagree')),
  worker_comment text,
  worker_at timestamptz,
  unique (user_id, period_month)
);
alter table public.pay_closings enable row level security;
create policy close_read on public.pay_closings for select
  using (business_id = my_business() and (user_id = auth.uid() or is_owner()));

-- Recalcula el arrastre de una persona desde su saldo inicial, en orden.
create or replace function public.recalc_carry(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  prev int;
  r record;
begin
  select opening_minutes into prev from profiles where id = p_user;
  for r in select id, balance_minutes, paid_minutes, carried_in from pay_closings where user_id = p_user order by period_month loop
    if r.carried_in <> prev then
      update pay_closings set carried_in = prev, carried_out = prev + balance_minutes - paid_minutes,
             worker_status = 'pending', worker_comment = null, worker_at = null
       where id = r.id;
    end if;
    prev := prev + r.balance_minutes - r.paid_minutes;
  end loop;
end $$;

create or replace function public.close_period(p_user uuid, p_month date, p_paid int, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  pb record;
  prev int;
begin
  if not is_owner() then raise exception 'Solo la encargada'; end if;
  if not exists (select 1 from profiles where id = p_user and business_id = my_business()) then raise exception 'Trabajador no válido'; end if;
  if p_paid < 0 then raise exception 'Horas pagadas no válidas'; end if;
  select * into pb from period_balance(p_user, date_trunc('month', p_month)::date);
  select coalesce((select carried_out from pay_closings where user_id = p_user and period_month < date_trunc('month', p_month)::date
                    order by period_month desc limit 1),
                  (select opening_minutes from profiles where id = p_user)) into prev;

  insert into pay_closings as pc (business_id, user_id, period_month, start_date, end_date, carried_in, worked_minutes,
                            contract_minutes, balance_minutes, paid_minutes, carried_out, note, closed_by)
  values (my_business(), p_user, date_trunc('month', p_month)::date, pb.start_date, pb.end_date, prev, pb.worked_minutes,
          pb.contract_minutes, pb.balance_minutes, p_paid, prev + pb.balance_minutes - p_paid, nullif(p_note, ''), auth.uid())
  on conflict (user_id, period_month) do update set
    start_date = excluded.start_date, end_date = excluded.end_date, carried_in = excluded.carried_in,
    worked_minutes = excluded.worked_minutes, contract_minutes = excluded.contract_minutes,
    balance_minutes = excluded.balance_minutes, paid_minutes = excluded.paid_minutes,
    carried_out = excluded.carried_out, note = excluded.note, closed_by = excluded.closed_by, closed_at = now(),
    worker_status = 'pending', worker_comment = null, worker_at = null;

  perform recalc_carry(p_user);
end $$;
revoke all on function public.close_period(uuid, date, int, text) from public, anon;
grant execute on function public.close_period(uuid, date, int, text) to authenticated;

create or replace function public.respond_closing(p_id uuid, p_agree boolean, p_comment text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update pay_closings set worker_status = case when p_agree then 'agree' else 'disagree' end,
         worker_comment = nullif(p_comment, ''), worker_at = now()
   where id = p_id and user_id = auth.uid();
  if not found then raise exception 'Cierre no encontrado'; end if;
end $$;
revoke all on function public.respond_closing(uuid, boolean, text) from public, anon;
grant execute on function public.respond_closing(uuid, boolean, text) to authenticated;

create or replace function public.set_opening(p_user uuid, p_minutes int, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'Solo la encargada'; end if;
  update profiles set opening_minutes = p_minutes, opening_note = nullif(p_note, '')
   where id = p_user and business_id = my_business();
  perform recalc_carry(p_user);
end $$;
revoke all on function public.set_opening(uuid, int, text) from public, anon;
grant execute on function public.set_opening(uuid, int, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Historial de cambios de turnos (lo ve la trabajadora afectada y la encargada)
-- ---------------------------------------------------------------------
create table if not exists public.shift_changes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  shift_id uuid,
  user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('created_past','changed','deleted','reassigned_out','reassigned_in','punch_voided')),
  reason text,
  old_starts timestamptz, old_ends timestamptz,
  new_starts timestamptz, new_ends timestamptz,
  changed_by uuid,
  at timestamptz not null default now()
);
create index if not exists shift_changes_user on public.shift_changes (user_id, at desc);
alter table public.shift_changes enable row level security;
create policy changes_read on public.shift_changes for select
  using (business_id = my_business() and (user_id = auth.uid() or is_owner()));

create or replace function public.log_shift_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.starts_at < now() then
      insert into shift_changes (business_id, shift_id, user_id, action, new_starts, new_ends, changed_by)
      values (new.business_id, new.id, new.user_id, 'created_past', new.starts_at, new.ends_at, auth.uid());
    end if;
    return new;
  elsif old.created_at > now() - interval '15 minutes' and old.starts_at > now() then
    -- Turno recién puesto que se está retocando mientras se hace el cuadrante: no se apunta.
    return case when tg_op = 'DELETE' then old else new end;
  elsif tg_op = 'DELETE' then
    insert into shift_changes (business_id, shift_id, user_id, action, old_starts, old_ends, changed_by)
    values (old.business_id, old.id, old.user_id, 'deleted', old.starts_at, old.ends_at, auth.uid());
    return old;
  else
    if new.user_id <> old.user_id then
      insert into shift_changes (business_id, shift_id, user_id, action, old_starts, old_ends, changed_by)
      values (old.business_id, old.id, old.user_id, 'reassigned_out', old.starts_at, old.ends_at, auth.uid());
      insert into shift_changes (business_id, shift_id, user_id, action, new_starts, new_ends, changed_by)
      values (new.business_id, new.id, new.user_id, 'reassigned_in', new.starts_at, new.ends_at, auth.uid());
    elsif (new.starts_at, new.ends_at) is distinct from (old.starts_at, old.ends_at) then
      insert into shift_changes (business_id, shift_id, user_id, action, old_starts, old_ends, new_starts, new_ends, changed_by)
      values (new.business_id, new.id, new.user_id, 'changed', old.starts_at, old.ends_at, new.starts_at, new.ends_at, auth.uid());
    end if;
    return new;
  end if;
end $$;

drop trigger if exists shifts_log on public.shifts;
create trigger shifts_log after insert or update or delete on public.shifts
  for each row execute function public.log_shift_change();

-- ---------------------------------------------------------------------
-- 6. Un turno ya fichado y terminado no se puede recortar, mover ni borrar.
--    (Si hay un error, se arregla con una corrección de fichaje, que queda registrada.)
-- ---------------------------------------------------------------------
create or replace function public.protect_worked_shift() returns trigger
language plpgsql as $$
begin
  if old.ends_at < now() and exists (select 1 from punches p where p.shift_id = old.id) then
    if tg_op = 'DELETE' then
      raise exception 'Este turno ya está fichado y terminado: no se puede borrar';
    elsif (new.starts_at, new.ends_at, new.user_id) is distinct from (old.starts_at, old.ends_at, old.user_id) then
      raise exception 'Este turno ya está fichado y terminado: no se puede cambiar';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists shifts_protect on public.shifts;
create trigger shifts_protect before update or delete on public.shifts
  for each row execute function public.protect_worked_shift();

-- ---------------------------------------------------------------------
-- 7. Fichajes sin turno → turno con las horas reales fichadas
-- ---------------------------------------------------------------------
create or replace function public.shift_from_punches(p_user uuid, p_date date)
returns int language plpgsql security definer set search_path = public as $$
declare
  tz text;
  r record;
  in_id uuid;
  in_at timestamptz;
  sid uuid;
  n int := 0;
begin
  if not is_owner() then raise exception 'Solo la encargada'; end if;
  select timezone into tz from businesses where id = my_business();
  for r in select * from punches
            where user_id = p_user and business_id = my_business() and shift_id is null
              and voided_at is null
              and (at at time zone tz)::date = p_date
            order by at loop
    if r.kind = 'in' then
      in_id := r.id;
      in_at := r.at;
    elsif in_id is not null then
      insert into shifts (business_id, user_id, starts_at, ends_at, label)
      values (my_business(), p_user, in_at, r.at, 'Sin turno previo') returning id into sid;
      update punches set shift_id = sid where id in (in_id, r.id);
      in_id := null;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.shift_from_punches(uuid, date) from public, anon;
grant execute on function public.shift_from_punches(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Anular un fichaje por error. Nunca se borra: queda marcado como anulado,
--    con quién, cuándo y por qué, y deja de contar.
--    · La propia trabajadora puede anular su fichaje en los 10 minutos siguientes.
--    · Después, solo la encargada (con motivo).
-- ---------------------------------------------------------------------
alter table public.punches add column if not exists voided_at timestamptz;
alter table public.punches add column if not exists voided_by uuid references public.profiles(id);
alter table public.punches add column if not exists void_reason text;

-- La vista de turnos ignora los fichajes anulados.
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
left join punches p on p.shift_id = s.id and p.voided_at is null
group by s.id;

create or replace function public.void_punch(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  pu punches%rowtype;
begin
  select * into pu from punches where id = p_id and business_id = my_business() and voided_at is null;
  if pu.id is null then raise exception 'Fichaje no encontrado'; end if;
  if not is_owner() then
    if pu.user_id <> auth.uid() or pu.created_at < now() - interval '10 minutes' then
      raise exception 'Pasados 10 minutos, solo la encargada puede anular un fichaje';
    end if;
  elsif coalesce(trim(p_reason), '') = '' and pu.user_id <> auth.uid() then
    raise exception 'Escribe el motivo';
  end if;
  update punches set voided_at = now(), voided_by = auth.uid(),
         void_reason = coalesce(nullif(trim(p_reason), ''), 'Anulado por la propia trabajadora')
   where id = pu.id;
  insert into shift_changes (business_id, shift_id, user_id, action, old_starts, changed_by, reason)
  values (pu.business_id, pu.shift_id, pu.user_id, 'punch_voided', pu.at, auth.uid(),
          (case when pu.kind = 'in' then 'Entrada' else 'Salida' end) || ' · ' ||
          coalesce(nullif(trim(p_reason), ''), 'Anulado por la propia trabajadora'));
end $$;
revoke all on function public.void_punch(uuid, text) from public, anon;
grant execute on function public.void_punch(uuid, text) to authenticated;

-- Fichar: ignora los fichajes anulados y devuelve el id para poder anularlo.
drop function if exists public.fichar(text);
create function public.fichar(p_code text)
returns table (id uuid, kind text, at timestamptz, shift_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  me profiles%rowtype;
  biz businesses%rowtype;
  s shifts%rowtype;
  k text;
  last_kind text;
  last_at timestamptz;
  new_id uuid;
begin
  select * into me from profiles where profiles.id = auth.uid() and active;
  if me.id is null then raise exception 'No has iniciado sesión'; end if;

  select * into biz from businesses where businesses.id = me.business_id;
  if biz.qr_secret is distinct from p_code then
    raise exception 'Este QR no es el de tu local';
  end if;

  select * into s from shifts sh
   where sh.user_id = me.id
     and now() between sh.starts_at - interval '2 hours' and sh.ends_at + interval '4 hours'
   order by abs(extract(epoch from (now() - sh.starts_at))) limit 1;

  select p.kind, p.at into last_kind, last_at from punches p
   where p.user_id = me.id and p.voided_at is null
     and (p.shift_id = s.id or (s.id is null and p.at > now() - interval '16 hours'))
   order by p.at desc limit 1;

  if last_at is not null and now() - last_at < interval '2 minutes' then
    raise exception 'Ya has fichado hace un momento';
  end if;

  k := case when last_kind = 'in' then 'out' else 'in' end;

  insert into punches (business_id, user_id, shift_id, kind, source)
  values (me.business_id, me.id, s.id, k, 'qr') returning punches.id into new_id;

  return query select new_id, k, now(), s.id, s.starts_at, s.ends_at;
end $$;
revoke all on function public.fichar(text) from public, anon;
grant execute on function public.fichar(text) to authenticated;

-- Lo "fichado" que protege un turno, o que impide quitarlo, son fichajes NO anulados.
create or replace function public.protect_worked_shift() returns trigger
language plpgsql as $$
begin
  if old.ends_at < now() and exists (select 1 from punches p where p.shift_id = old.id and p.voided_at is null) then
    if tg_op = 'DELETE' then
      raise exception 'Este turno ya está fichado y terminado: no se puede borrar';
    elsif (new.starts_at, new.ends_at, new.user_id) is distinct from (old.starts_at, old.ends_at, old.user_id) then
      raise exception 'Este turno ya está fichado y terminado: no se puede cambiar';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
