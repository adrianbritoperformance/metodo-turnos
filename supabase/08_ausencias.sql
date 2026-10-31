-- =====================================================================
-- Método Café · Actualización 8: ausencias (vacaciones, asuntos propios, baja)
-- Solo informativo: se ve en el calendario y en la nómina, NO cambia las horas.
-- Ejecutar entero en Supabase → SQL Editor (una vez), DESPUÉS de 07_reponer.sql.
-- =====================================================================

create table if not exists public.absences (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('vacaciones','asuntos','baja')),
  start_date date not null,
  end_date date not null,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists absences_dates on public.absences (business_id, start_date, end_date);

alter table public.absences enable row level security;
-- Todo el equipo las ve (igual que el cuadrante); solo la encargada las pone o quita.
create policy abs_read on public.absences for select using (business_id = my_business());
create policy abs_insert on public.absences for insert
  with check (business_id = my_business() and is_owner()
              and exists (select 1 from profiles p where p.id = user_id and p.business_id = my_business()));
create policy abs_update on public.absences for update
  using (business_id = my_business() and is_owner()) with check (business_id = my_business());
create policy abs_delete on public.absences for delete using (business_id = my_business() and is_owner());
