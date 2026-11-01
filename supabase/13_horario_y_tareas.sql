-- =====================================================================
-- Método Café · Actualización 13
--   1. Horario por franjas (como la tabla de Word) y franjas editables.
--   2. Colores únicos por persona dentro del local.
--   3. Reponer con dos estados: Hay / Pedir.
--   4. Mensajes entre compañeras.
--   5. Tareas que se repiten (por persona o por puesto).
-- Ejecutar entero en Supabase → SQL Editor (una vez), DESPUÉS de 12_plantilla.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Franjas del horario
-- ---------------------------------------------------------------------
create table if not exists public.day_blocks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  weekdays smallint[] not null check (cardinality(weekdays) > 0 and weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  start_time time not null,
  end_time time not null check (end_time > start_time),
  created_at timestamptz not null default now()
);
alter table public.day_blocks enable row level security;
drop policy if exists blocks_read on public.day_blocks;
drop policy if exists blocks_write on public.day_blocks;
create policy blocks_read on public.day_blocks for select using (business_id = my_business());
create policy blocks_write on public.day_blocks for all
  using (business_id = my_business() and is_owner())
  with check (business_id = my_business() and is_owner());

-- Horario de partida de Método (lunes por la mañana cerrado; sábado y domingo mañana y tarde).
insert into public.day_blocks (business_id, weekdays, start_time, end_time)
select b.id, x.wd, x.st, x.en
  from public.businesses b
  cross join (values
    ('{2}'::smallint[],         time '08:30', time '09:30'),
    ('{2}'::smallint[],         time '09:30', time '12:00'),
    ('{3,4,5}'::smallint[],     time '09:00', time '10:00'),
    ('{3,4,5}'::smallint[],     time '10:00', time '12:00'),
    ('{2,3,4,5}'::smallint[],   time '12:00', time '13:30'),
    ('{1,2,3,4,5}'::smallint[], time '16:00', time '17:00'),
    ('{1,2,3,4,5}'::smallint[], time '17:00', time '20:00'),
    ('{6,7}'::smallint[],       time '09:30', time '13:30'),
    ('{6,7}'::smallint[],       time '16:00', time '20:30')
  ) as x(wd, st, en)
 where b.join_code = 'METODO2026'
   and not exists (select 1 from public.day_blocks d where d.business_id = b.id);

-- Los turnos tipo de Plantilla, al mismo horario: lunes sin mañana, domingo con mañana.
update public.shift_templates t set weekdays = array_remove(t.weekdays, 1::smallint)
  from public.businesses b
 where b.id = t.business_id and b.join_code = 'METODO2026' and t.name = 'Mañana'
   and 1 = any (t.weekdays) and cardinality(t.weekdays) > 1;
update public.shift_templates t set weekdays = t.weekdays || 7::smallint
  from public.businesses b
 where b.id = t.business_id and b.join_code = 'METODO2026' and t.name = 'Mañana'
   and 6 = any (t.weekdays) and not 7 = any (t.weekdays);

-- Poner o quitar a una persona en una franja de un día.
--   Poner: si ya tiene un turno pegado o que se solapa, se alarga (las franjas seguidas
--          forman un solo turno); si no, se crea un turno con las horas de la franja.
--   Quitar: se recorta el turno; si la franja estaba en medio, queda partido en dos.
create or replace function public.toggle_block(p_user uuid, p_date date, p_block uuid, p_on boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  blk day_blocks%rowtype;
  tz text;
  bs timestamptz;
  be timestamptz;
  keep_id uuid;
  lo timestamptz;
  hi timestamptz;
  s record;
begin
  if not is_owner() then raise exception 'Solo los admins pueden editar el horario'; end if;
  select * into blk from day_blocks where id = p_block and business_id = my_business();
  if blk.id is null then raise exception 'Franja no válida'; end if;
  if not exists (select 1 from profiles where id = p_user and business_id = my_business() and active) then
    raise exception 'Persona no válida';
  end if;
  select timezone into tz from businesses where id = my_business();
  bs := (p_date + blk.start_time) at time zone tz;
  be := (p_date + blk.end_time) at time zone tz;

  if p_on then
    if exists (select 1 from shifts where user_id = p_user and starts_at <= bs and ends_at >= be) then
      return 'sin cambios';
    end if;
    select min(starts_at), max(ends_at) into lo, hi
      from shifts where user_id = p_user and starts_at <= be and ends_at >= bs;
    if lo is null then
      insert into shifts (business_id, user_id, starts_at, ends_at) values (my_business(), p_user, bs, be);
      return 'puesto';
    end if;
    -- Se conserva el que tenga fichajes (o el primero) y se juntan los demás en él.
    select sh.id into keep_id from shifts sh
     where sh.user_id = p_user and sh.starts_at <= be and sh.ends_at >= bs
     order by exists (select 1 from punches p where p.shift_id = sh.id and p.voided_at is null) desc, sh.starts_at
     limit 1;
    delete from shifts where user_id = p_user and starts_at <= be and ends_at >= bs and id <> keep_id;
    update shifts set starts_at = least(lo, bs), ends_at = greatest(hi, be) where id = keep_id;
    return 'puesto';
  end if;

  for s in select * from shifts where user_id = p_user and starts_at < be and ends_at > bs loop
    if s.starts_at < bs and s.ends_at > be then
      update shifts set ends_at = bs where id = s.id;
      insert into shifts (business_id, user_id, starts_at, ends_at, label, template_id)
      values (s.business_id, s.user_id, be, s.ends_at, s.label, s.template_id);
    elsif s.starts_at < bs then
      update shifts set ends_at = bs where id = s.id;
    elsif s.ends_at > be then
      update shifts set starts_at = be where id = s.id;
    else
      delete from shifts where id = s.id;
    end if;
  end loop;
  return 'quitado';
end $$;
revoke all on function public.toggle_block(uuid, date, uuid, boolean) from public, anon;
grant execute on function public.toggle_block(uuid, date, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Colores únicos dentro del local (entre las cuentas activas)
-- ---------------------------------------------------------------------
create or replace function public.free_color(p_business uuid, p_except uuid default null)
returns text language sql stable security definer set search_path = public as $$
  select x.c from unnest(array['#C0392B','#E67E22','#C9A227','#2E8B57','#138D90',
                               '#2F6FB5','#7D3C98','#D35490','#8D6E63','#34495E']) with ordinality as x(c, i)
   where not exists (select 1 from profiles p
                      where p.business_id = p_business and p.active and p.color is not null
                        and upper(p.color) = upper(x.c) and p.id is distinct from p_except)
   order by x.i limit 1
$$;

-- Repetidos: se queda el color quien lo tenía antes; al resto se le da uno libre.
update public.profiles p set color = null
 where p.active and p.color is not null and exists (
   select 1 from public.profiles q
    where q.business_id = p.business_id and q.active and upper(q.color) = upper(p.color)
      and (q.created_at, q.id) < (p.created_at, p.id));
do $$
declare r record;
begin
  for r in select id, business_id from public.profiles where active and color is null order by created_at loop
    update public.profiles set color = public.free_color(r.business_id, r.id) where id = r.id;
  end loop;
end $$;
create unique index if not exists profiles_color_unique
  on public.profiles (business_id, upper(color)) where color is not null and active;

-- Cuentas nuevas (o que vuelven de baja) reciben un color libre automáticamente.
create or replace function public.profile_color() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.active and (new.color is null or exists (
       select 1 from profiles p where p.business_id = new.business_id and p.active and p.id <> new.id
          and p.color is not null and upper(p.color) = upper(new.color))) then
    new.color := free_color(new.business_id, new.id);
  end if;
  return new;
end $$;
drop trigger if exists profiles_color on public.profiles;
create trigger profiles_color before insert or update of active, color on public.profiles
  for each row execute function public.profile_color();

create or replace function public.set_my_color(p_color text)
returns void language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if p_color is null or p_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Color no válido'; end if;
  select p.full_name into who from profiles p, profiles me
   where me.id = auth.uid() and p.business_id = me.business_id and p.active and p.id <> me.id
     and upper(p.color) = upper(p_color) limit 1;
  if who is not null then raise exception 'Ese color ya lo tiene %', split_part(who, ' ', 1); end if;
  update profiles set color = p_color where id = auth.uid();
end $$;
revoke all on function public.set_my_color(text) from public, anon;
grant execute on function public.set_my_color(text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Reponer: solo "Hay" (0) y "Pedir" (2). Lo que estaba en "Queda poco" pasa a "Pedir".
-- ---------------------------------------------------------------------
update public.stock_items set status = 2 where status = 1;

-- ---------------------------------------------------------------------
-- 4. Mensajes entre compañeras (las tareas siguen siendo solo de los admins).
--    Los admins ven todos los mensajes.
-- ---------------------------------------------------------------------
drop policy if exists notices_read on public.notices;
drop policy if exists notices_insert on public.notices;
drop policy if exists notices_delete on public.notices;
create policy notices_read on public.notices for select
  using (business_id = my_business()
         and (is_owner() or cardinality(user_ids) = 0 or auth.uid() = any (user_ids) or created_by = auth.uid()));
create policy notices_insert on public.notices for insert
  with check (business_id = my_business() and created_by = auth.uid() and (is_owner() or kind = 'mensaje'));
create policy notices_delete on public.notices for delete
  using (business_id = my_business() and (is_owner() or created_by = auth.uid()));

-- ---------------------------------------------------------------------
-- 5. Tareas que se repiten
--    Cada semana ciertos días (los 7 = todos los días), para unas personas y/o unos puestos.
--    Le sale a quien cumpla eso Y trabaje ese día (en la mañana, la tarde o cualquiera).
-- ---------------------------------------------------------------------
create table if not exists public.task_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  weekdays smallint[] not null check (cardinality(weekdays) > 0 and weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  user_ids uuid[] not null default '{}',
  jobs text[] not null default '{}',
  part text not null default 'any' check (part in ('any', 'morning', 'afternoon')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (cardinality(user_ids) + cardinality(jobs) > 0)
);
alter table public.task_rules enable row level security;
drop policy if exists rules_read on public.task_rules;
drop policy if exists rules_write on public.task_rules;
create policy rules_read on public.task_rules for select using (business_id = my_business() and is_owner());
create policy rules_write on public.task_rules for all
  using (business_id = my_business() and is_owner())
  with check (business_id = my_business() and is_owner());

create table if not exists public.task_done (
  rule_id uuid not null references public.task_rules(id) on delete cascade,
  day date not null,
  done_by uuid references public.profiles(id) on delete set null,
  done_at timestamptz not null default now(),
  primary key (rule_id, day)
);
alter table public.task_done enable row level security;   -- solo por las funciones de abajo

-- Tareas que se repiten de un día, con a quién le salen y si están hechas.
-- Los admins ven todas; cada trabajadora, solo las suyas.
create or replace function public.tasks_for_day(p_day date)
returns table (rule_id uuid, body text, part text, jobs text[], assignees uuid[], done_by uuid, done_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare tz text;
begin
  select timezone into tz from businesses where id = my_business();
  return query
  with r as (
    select t.*, coalesce((
      select array_agg(distinct p.id) from profiles p
       where p.business_id = t.business_id and p.active
         and (p.id = any (t.user_ids)
              or lower(trim(coalesce(p.job_title, ''))) = any (select lower(trim(j)) from unnest(t.jobs) j))
         and exists (select 1 from shifts s
                      where s.user_id = p.id and (s.starts_at at time zone tz)::date = p_day
                        and (t.part = 'any'
                             or (t.part = 'morning') = (extract(hour from s.starts_at at time zone tz) < 14)))
    ), '{}') as who
    from task_rules t
    where t.business_id = my_business() and extract(isodow from p_day)::smallint = any (t.weekdays)
  )
  select r.id, r.body, r.part, r.jobs, r.who, d.done_by, d.done_at
    from r left join task_done d on d.rule_id = r.id and d.day = p_day
   where is_owner() or auth.uid() = any (r.who)
   order by r.created_at;
end $$;
revoke all on function public.tasks_for_day(date) from public, anon;
grant execute on function public.tasks_for_day(date) to authenticated;

create or replace function public.set_rule_done(p_rule uuid, p_day date, p_done boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from tasks_for_day(p_day) t where t.rule_id = p_rule) then
    raise exception 'Esta tarea no es para ti';
  end if;
  if p_done then
    insert into task_done (rule_id, day, done_by) values (p_rule, p_day, auth.uid())
    on conflict (rule_id, day) do update set done_by = excluded.done_by, done_at = now();
  else
    delete from task_done where rule_id = p_rule and day = p_day;
  end if;
end $$;
revoke all on function public.set_rule_done(uuid, date, boolean) from public, anon;
grant execute on function public.set_rule_done(uuid, date, boolean) to authenticated;
