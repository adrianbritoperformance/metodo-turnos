-- =====================================================================
-- Método Café · Actualización 10: las ausencias de cada persona son privadas
--   Los admins ven las de todo el equipo; cada trabajadora solo la suya.
-- Ejecutar entero en Supabase → SQL Editor (una vez), DESPUÉS de 09_avisos.sql.
-- =====================================================================

drop policy if exists abs_read on public.absences;
create policy abs_read on public.absences for select
  using (business_id = my_business() and (is_owner() or user_id = auth.uid()));
