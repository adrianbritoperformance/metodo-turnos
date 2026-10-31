-- =====================================================================
-- Método Café · EQUIPO DE DEMOSTRACIÓN EN EL LOCAL REAL
-- Crea cuentas provisionales para el equipo de Método, con su horario
-- habitual y los turnos de esta semana y la siguiente (y fichajes de los
-- días ya pasados), para enseñar la app con la semana real.
--
-- · Laura (Barista) · Miriam (Sala) · María (Cocina-Sala) · Lucía (Cocina) · Luisa (Sala)
--   correo: nombre@demo.metodo  ·  contraseña: Demo1234
-- · Rocío usa SU cuenta real (no se tocan sus fichajes ni sus turnos ya puestos).
-- · La cuenta de Adrián (adrianbritot@gmail.com) pasa a vista Admin.
--
-- Cuando cada una se registre con su correo de verdad: demo_borrar.sql
-- Ejecutar entero en Supabase → SQL Editor, DESPUÉS de 12_plantilla.sql.
-- =====================================================================

do $$
declare
  biz uuid;
  tz text := 'Europe/Madrid';
  mon date := date_trunc('week', (now() at time zone 'Europe/Madrid'))::date;   -- lunes de esta semana
  u record;
  ids jsonb := '{}';
  rocio uuid;
  t_mlv uuid; t_msa uuid; t_tlv uuid; t_twe uuid;
begin
  select id into biz from businesses where join_code = 'METODO2026';
  if biz is null then raise exception 'No encuentro el local METODO2026'; end if;
  if exists (select 1 from auth.users where email like '%@demo.metodo') then
    raise exception 'Las cuentas de demostración ya existen. Ejecuta antes demo_borrar.sql';
  end if;

  select id into t_mlv from shift_templates where business_id = biz and name = 'Mañana' and 1 = any (weekdays) limit 1;
  select id into t_msa from shift_templates where business_id = biz and name = 'Mañana' and 6 = any (weekdays) limit 1;
  select id into t_tlv from shift_templates where business_id = biz and name = 'Tarde'  and 1 = any (weekdays) limit 1;
  select id into t_twe from shift_templates where business_id = biz and name = 'Tarde'  and 7 = any (weekdays) limit 1;
  if t_mlv is null or t_msa is null or t_tlv is null or t_twe is null then
    raise exception 'Faltan los turnos tipo (Mañana/Tarde). ¿Está ejecutado 04_colores_y_horarios.sql?';
  end if;

  -- Adrián: vista Admin
  update profiles p set role = 'owner', job_title = 'Administrador'
    from auth.users au where au.id = p.id and lower(au.email) = 'adrianbritot@gmail.com';

  -- Rocío: su cuenta real, vista Equipo
  select p.id into rocio from profiles p join auth.users au on au.id = p.id
   where p.business_id = biz and p.full_name ilike 'roc%' and au.email not like '%@demo.metodo'
   order by p.created_at limit 1;
  if rocio is not null then
    update profiles set role = 'worker', job_title = 'Barista', weekly_hours = 40,
           color = coalesce(color, '#D35490'), active = true
     where id = rocio;
    ids := ids || jsonb_build_object('rocio', rocio);
  end if;

  -- Cuentas provisionales del resto del equipo
  for u in select * from (values
      ('laura',  'Laura',  'Barista',     40::numeric, '#2F6FB5'),
      ('maria',  'María',  'Cocina-Sala', 30,          '#C9A227'),
      ('luisa',  'Luisa',  'Sala',        30,          '#E67E22'),
      ('miriam', 'Miriam', 'Sala',        20,          '#7D3C98'),
      ('lucia',  'Lucía',  'Cocina',      20,          '#2E8B57')
    ) as x(slug, name, job, hours, color)
  loop
    declare uid uuid := gen_random_uuid(); em text := u.slug || '@demo.metodo';
    begin
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                              confirmation_token, email_change, email_change_token_new, recovery_token)
      values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em,
              extensions.crypt('Demo1234', extensions.gen_salt('bf')), now(),
              '{"provider":"email","providers":["email"]}',
              jsonb_build_object('full_name', u.name, 'join_code', 'METODO2026'), now(), now(), '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid, uid::text,
              jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true), 'email', now(), now(), now());
      update profiles set role = 'worker', job_title = u.job, weekly_hours = u.hours, color = u.color, active = true
       where id = uid;
      ids := ids || jsonb_build_object(u.slug, uid);
    end;
  end loop;

  -- Horario habitual (weekday: 1 = lunes … 7 = domingo). El de Rocío solo si aún no tiene.
  insert into usual_slots (business_id, user_id, weekday, template_id, start_time, end_time)
  select biz, (ids->>x.who)::uuid, x.wd, x.tpl, t.start_time, t.end_time
    from (values
      -- Rocío 40 h: lunes a jueves mañana y tarde + sábado mañana
      ('rocio',1,t_mlv),('rocio',1,t_tlv),('rocio',2,t_mlv),('rocio',2,t_tlv),('rocio',3,t_mlv),('rocio',3,t_tlv),
      ('rocio',4,t_mlv),('rocio',4,t_tlv),('rocio',6,t_msa),
      -- Laura 40 h: lunes tarde + martes a viernes mañana y tarde
      ('laura',1,t_tlv),('laura',2,t_mlv),('laura',2,t_tlv),('laura',3,t_mlv),('laura',3,t_tlv),
      ('laura',4,t_mlv),('laura',4,t_tlv),('laura',5,t_mlv),('laura',5,t_tlv),
      -- María 30 h
      ('maria',1,t_mlv),('maria',3,t_mlv),('maria',4,t_mlv),('maria',5,t_tlv),('maria',6,t_twe),('maria',7,t_twe),
      -- Luisa 30 h
      ('luisa',1,t_tlv),('luisa',2,t_mlv),('luisa',3,t_tlv),('luisa',5,t_mlv),('luisa',6,t_msa),('luisa',6,t_twe),('luisa',7,t_twe),
      -- Miriam 20 h
      ('miriam',2,t_tlv),('miriam',4,t_tlv),('miriam',6,t_twe),('miriam',7,t_twe),
      -- Lucía 20 h
      ('lucia',1,t_mlv),('lucia',3,t_tlv),('lucia',5,t_mlv),('lucia',7,t_twe)
    ) as x(who, wd, tpl)
    join shift_templates t on t.id = x.tpl
   where ids ? x.who
     and not (x.who = 'rocio' and exists (select 1 from usual_slots us where us.user_id = rocio));

  -- Turnos de esta semana y la siguiente desde el horario habitual, sin pisar lo que ya esté puesto.
  -- (El historial se apaga un momento para que no salgan como "añadidos después".)
  alter table shifts disable trigger shifts_log;
  insert into shifts (business_id, user_id, starts_at, ends_at, template_id)
  select biz, us.user_id, x.st, x.en, us.template_id
    from usual_slots us
    cross join generate_series(0, 1) w
    cross join lateral (select ((mon + w * 7 + us.weekday - 1) + us.start_time) at time zone tz as st,
                               ((mon + w * 7 + us.weekday - 1) + us.end_time) at time zone tz as en) x
   where us.business_id = biz
     and us.user_id in (select (value #>> '{}')::uuid from jsonb_each(ids))
     and not exists (select 1 from shifts s where s.user_id = us.user_id and s.starts_at < x.en and x.st < s.ends_at);
  alter table shifts enable trigger shifts_log;

  -- Fichajes de los días ya pasados, SOLO de las cuentas provisionales (Rocío ficha de verdad).
  insert into punches (business_id, user_id, shift_id, kind, at, source)
  select s.business_id, s.user_id, s.id, 'in',
         s.starts_at - make_interval(mins => (abs(hashtext(s.id::text)) % 9)), 'qr'
    from shifts s join auth.users au on au.id = s.user_id
   where s.business_id = biz and au.email like '%@demo.metodo' and s.starts_at <= now()
     and not (s.user_id = (ids->>'miriam')::uuid and s.ends_at > now());   -- Miriam "se olvida" de fichar el turno en curso
  insert into punches (business_id, user_id, shift_id, kind, at, source)
  select s.business_id, s.user_id, s.id, 'out',
         s.ends_at + make_interval(mins => (case when abs(hashtext(s.id::text || 'x')) % 10 < 6 then abs(hashtext(s.id::text)) % 4
                                                 else 10 + abs(hashtext(s.id::text)) % 21 end)), 'qr'
    from shifts s join auth.users au on au.id = s.user_id
   where s.business_id = biz and au.email like '%@demo.metodo' and s.ends_at <= now();
end $$;
