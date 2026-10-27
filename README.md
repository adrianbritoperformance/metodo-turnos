# Método Café · App de turnos

Fichaje con QR, bolsa de horas, cuadrante y reposición. Next.js + Supabase, desplegada en Vercel. Se instala en el móvil desde el navegador (no está en ninguna tienda).

## Regla de la bolsa de horas

**Saldo semanal frente al contrato** (semana de lunes a domingo):
- Horas hechas de cada turno = duración prevista + lo que se sale **después** de la hora de fin.
  Entrar antes no suma; entrar tarde no resta.
- Saldo de la semana = horas hechas − horas de contrato de esa persona. Si hace más, suma; si hace menos, resta.
- El saldo del mes es la suma de sus semanas cerradas (semanas que empiezan en ese mes).
- Las semanas sin ningún turno (vacaciones) no cuentan.

Las horas de contrato de cada persona se cambian en **Gestión → Saldo del equipo** (por defecto 40 h).
La lógica está en las vistas `shift_balance` y `week_balance` (`supabase/02_contrato.sql`).

## Puesta en marcha

### 1. Supabase (base de datos y usuarios)
1. supabase.com → **New project** (región: Europe West / Frankfurt). Guarda la contraseña de la base de datos.
2. Menú **SQL Editor** → New query → pega todo `supabase/schema.sql` → **Run**. Después, en queries nuevas y en este orden: `02_contrato.sql`, `03_plantillas.sql`, `04_colores_y_horarios.sql` y `05_control.sql` (carpeta `supabase`) → **Run** cada una.
   - Crea el local "Método Café" con el código de alta **METODO2026** (puedes cambiarlo en la última parte del archivo antes de ejecutarlo).
3. **Authentication → Sign In / Providers → Email**: para pruebas, desactiva **Confirm email** (así no hay que confirmar por correo). Se puede volver a activar después.
4. **Project Settings → API**: copia `Project URL` y la clave `anon public`.

### 2. GitHub (el código)
1. github.com → **New repository** → `metodo-turnos` (privado).
2. Sube el contenido de esta carpeta (botón "uploading an existing file" y arrastras todo, **menos** `node_modules` y `.next` si existen).

### 3. Vercel (publicarla)
1. vercel.com → **Add New → Project** → importa el repo `metodo-turnos`.
2. En **Environment Variables** añade:
   - `NEXT_PUBLIC_SUPABASE_URL` = Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon public
3. **Deploy**. Te da una dirección tipo `metodo-turnos.vercel.app`.
4. En Supabase → **Authentication → URL Configuration** → *Site URL* = esa dirección.

### 4. Cuentas (el orden importa)
1. **Rocío primero**: entra en la web → "Crea tu cuenta" con el código del local. La **primera** cuenta del local queda como encargada.
2. Después tú (y el resto): misma página, mismo código → quedáis como trabajadores.
3. Rocío: pestaña **Gestión → QR para fichar → Imprimir**, y lo pega en la barra.

Si el orden sale mal, en el SQL Editor:
```sql
update profiles set role = 'owner'  where full_name ilike 'Rocío%';
update profiles set role = 'worker' where full_name ilike 'Adrián%';
```

### 5. Instalar en el móvil
- iPhone: abrir en Safari → Compartir → **Añadir a pantalla de inicio**.
- Android: Chrome → menú ⋮ → **Instalar aplicación**.

## Cómo se usa
- **Fichar**: botón "Escanear QR" dentro de la app (usa la cámara) o escanear el QR con la cámara del móvil. El primer escaneo es entrada, el siguiente salida. La hora la pone el servidor, no el teléfono.
- **Horas**: acumulado del mes y detalle por turno. Si se olvida fichar, "Pedir corrección" → la encargada la aprueba en Gestión.
- **Turnos**: cuadrante por día. La encargada crea, edita y borra turnos y puede dejar una tarea en cada uno. Los cambios salen marcados como "Turno cambiado" 48 h.
- **Reponer**: tocar un producto cambia Hay → Queda poco → Falta. La encargada ve la lista para pedir y pulsa "Pedido hecho".
- **Gestión** (solo encargada): correcciones, totales del equipo, CSV del registro de jornada del mes, QR y código de alta.

## Desarrollo en local
```bash
cp .env.example .env.local   # rellena las dos claves
npm install
npm run dev                  # http://localhost:3000
```
