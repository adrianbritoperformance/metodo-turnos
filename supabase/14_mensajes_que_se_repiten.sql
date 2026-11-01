-- =====================================================================
-- Método Café · Actualización 14: mensajes y tareas en Gestión
--   · Lo que se repite puede ser una tarea (se marca hecha) o un mensaje.
--   · Lo que se repite también puede ir a todo el equipo que trabaje ese día.
-- Ejecutar entero en Supabase → SQL Editor (una vez), DESPUÉS de 13_horario_y_tareas.sql.
-- =====================================================================

alter table public.task_rules add column if not exists kind text not null default 'tarea';
alter table public.task_rules add column if not exists everyone boolean not null default false;
alter table public.task_rules drop constraint if exists task_rules_kind_check;
alter table public.task_rules add constraint task_rules_kind_check check (kind in ('tarea', 'mensaje'));
alter table public.task_rules drop constraint if exists task_rules_check;
alter table public.task_rules drop constraint if exists task_rules_who_check;
alter table public.task_rules add constraint task_rules_who_check
  check (everyone or cardinality(user_ids) + cardinality(jobs) > 0);

drop function if exists public.tasks_for_day(date);
create function public.tasks_for_day(p_day date)
returns table (rule_id uuid, kind text, body text, part text, jobs text[], everyone boolean,
               assignees uuid[], done_by uuid, done_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare tz text;
begin
  select timezone into tz from businesses where id = my_business();
  return query
  with r as (
    select t.*, coalesce((
      select array_agg(distinct p.id) from profiles p
       where p.business_id = t.business_id and p.active
         and ((t.everyone and p.role = 'worker')
              or p.id = any (t.user_ids)
              or lower(trim(coalesce(p.job_title, ''))) = any (select lower(trim(j)) from unnest(t.jobs) j))
         and exists (select 1 from shifts s
                      where s.user_id = p.id and (s.starts_at at time zone tz)::date = p_day
                        and (t.part = 'any'
                             or (t.part = 'morning') = (extract(hour from s.starts_at at time zone tz) < 14)))
    ), '{}') as who
    from task_rules t
    where t.business_id = my_business() and extract(isodow from p_day)::smallint = any (t.weekdays)
  )
  select r.id, r.kind, r.body, r.part, r.jobs, r.everyone, r.who, d.done_by, d.done_at
    from r left join task_done d on d.rule_id = r.id and d.day = p_day
   where is_owner() or auth.uid() = any (r.who)
   order by r.kind desc, r.created_at;
end $$;
revoke all on function public.tasks_for_day(date) from public, anon;
grant execute on function public.tasks_for_day(date) to authenticated;

-- Solo las tareas se marcan como hechas (los mensajes no).
create or replace function public.set_rule_done(p_rule uuid, p_day date, p_done boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from tasks_for_day(p_day) t where t.rule_id = p_rule and t.kind = 'tarea') then
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
