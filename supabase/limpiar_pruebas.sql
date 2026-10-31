-- =====================================================================
-- Método Café · LIMPIAR RESTOS DE LAS PRUEBAS (se puede ejecutar cuando sea)
--  1. Quita los turnos y fichajes de prueba de la cuenta de Adrián (es admin, no ficha).
--  2. Si una persona tiene dos turnos que se pisan el mismo día, deja solo uno:
--     el que tenga fichajes; si no, el último que se tocó.
-- Al final dice si la protección contra solapes (06) está puesta.
-- =====================================================================

alter table public.shifts disable trigger shifts_protect;
alter table public.shifts disable trigger shifts_log;

delete from public.punches where user_id in (select id from auth.users where lower(email) = 'adrianbritot@gmail.com');
delete from public.shifts  where user_id in (select id from auth.users where lower(email) = 'adrianbritot@gmail.com');

with r as (
  select s.id, s.user_id, s.starts_at, s.ends_at,
         exists (select 1 from public.punches p where p.shift_id = s.id and p.voided_at is null) as fichado,
         coalesce(s.changed_at, s.created_at) as t
    from public.shifts s
)
delete from public.shifts d
 using r a, r b
 where d.id = a.id and a.user_id = b.user_id and a.id <> b.id
   and a.starts_at < b.ends_at and b.starts_at < a.ends_at
   and (b.fichado, b.t, b.id::text) > (a.fichado, a.t, a.id::text);

alter table public.shifts enable trigger shifts_protect;
alter table public.shifts enable trigger shifts_log;

select exists (select 1 from pg_trigger where tgname = 'shifts_no_overlap') as proteccion_solapes_puesta;
