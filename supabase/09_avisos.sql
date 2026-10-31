-- =====================================================================
-- Método Café · Actualización 9: avisos y tareas del día
--   Los admins dejan un mensaje o una tarea para un día, a una persona,
--   a varias o a todo el equipo. Las tareas se marcan como hechas.
-- Ejecutar entero en Supabase → SQL Editor (una vez), DESPUÉS de 08_ausencias.sql.
-- =====================================================================

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('mensaje','tarea')),
  body text not null check (length(trim(body)) > 0),
  user_ids uuid[] not null default '{}',     -- vacío = todo el equipo
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  done_by uuid references public.profiles(id),
  done_at timestamptz
);
create index if not exists notices_day on public.notices (business_id, day);

alter table public.notices enable row level security;
-- Cada persona ve los avisos dirigidos a ella o a todo el equipo; los admins, todos.
create policy notices_read on public.notices for select
  using (business_id = my_business()
         and (is_owner() or cardinality(user_ids) = 0 or auth.uid() = any (user_ids)));
create policy notices_insert on public.notices for insert
  with check (business_id = my_business() and is_owner());
create policy notices_delete on public.notices for delete
  using (business_id = my_business() and is_owner());

-- Marcar (o desmarcar) una tarea como hecha: la puede marcar quien la recibe o un admin.
create or replace function public.set_notice_done(p_id uuid, p_done boolean)
returns void language plpgsql security definer set search_path = public as $$
declare n notices%rowtype;
begin
  select * into n from notices where id = p_id and business_id = my_business() and kind = 'tarea';
  if n.id is null then raise exception 'Tarea no encontrada'; end if;
  if not (is_owner() or cardinality(n.user_ids) = 0 or auth.uid() = any (n.user_ids)) then
    raise exception 'Esta tarea no es para ti';
  end if;
  update notices set done_by = case when p_done then auth.uid() end,
                     done_at = case when p_done then now() end
   where id = n.id;
end $$;
revoke all on function public.set_notice_done(uuid, boolean) from public, anon;
grant execute on function public.set_notice_done(uuid, boolean) to authenticated;
