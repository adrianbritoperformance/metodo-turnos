-- =====================================================================
-- Método Café · Actualización 15: la bolsa de horas de Rocío empieza a cero
--   Las semanas de prueba (antes del lunes 2 de noviembre de 2026) dejan de contar
--   en su saldo: se compensa con un saldo inicial. Sus turnos y fichajes no se tocan.
-- Ejecutar entero en Supabase → SQL Editor (una vez), DESPUÉS de 14_mensajes_que_se_repiten.sql.
-- =====================================================================

update public.profiles p
   set opening_minutes = -coalesce((
         select sum(w.planned - p.weekly_hours * 60)
           from (select date_trunc('week', s.starts_at at time zone 'Europe/Madrid')::date as wk,
                        sum(extract(epoch from (s.ends_at - s.starts_at)) / 60) as planned
                   from public.shifts s
                  where s.user_id = p.id
                    and (s.starts_at at time zone 'Europe/Madrid')::date < date '2026-11-02'
                  group by 1) w
       ), 0)::int,
       opening_note = 'Puesta a cero: la bolsa cuenta desde el 2 de noviembre de 2026'
  from public.businesses b
 where b.id = p.business_id and b.join_code = 'METODO2026'
   and p.full_name ilike 'roc%' and p.role = 'worker';
