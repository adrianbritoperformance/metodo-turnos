-- =====================================================================
-- Método Café · BORRAR LAS CUENTAS DE DEMOSTRACIÓN
-- Quita Laura, Miriam, María, Lucía y Luisa provisionales (…@demo.metodo)
-- con sus turnos, fichajes y horarios. No toca la cuenta de Rocío ni la tuya.
-- =====================================================================

-- La protección de "turnos fichados no se borran" se apaga solo durante este borrado.
alter table public.shifts disable trigger shifts_protect;
alter table public.shifts disable trigger shifts_log;

delete from public.profiles where id in (select id from auth.users where email like '%@demo.metodo');
delete from auth.users where email like '%@demo.metodo';

alter table public.shifts enable trigger shifts_protect;
alter table public.shifts enable trigger shifts_log;
