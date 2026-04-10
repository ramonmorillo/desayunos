# Desayunos equipo

Aplicación web móvil (HTML/CSS/JS sin frameworks) para gestionar desayunos diarios de un equipo hospitalario con Supabase.

## Archivos

- `index.html`
- `styles.css`
- `app.js`
- `config.example.js`
- `config.js` (local, no subir claves reales)

## 1) Configurar Supabase (`config.js`)

1. Copia el archivo de ejemplo:
   ```bash
   cp config.example.js config.js
   ```
2. Edita `config.js` y completa:
   ```js
   window.APP_CONFIG = {
     SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
     SUPABASE_ANON_KEY: 'TU-ANON-KEY',
   };
   ```

La app usa `createClient()` de Supabase JS cargado por CDN:
`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`

## 2) Ejecutar localmente

Como son archivos estáticos, puedes abrir `index.html` directamente o usar un servidor estático simple.

## 3) Despliegue en GitHub Pages

1. Sube estos archivos al repositorio.
2. En GitHub: **Settings → Pages**.
3. En **Build and deployment**, selecciona:
   - **Source**: `Deploy from a branch`
   - **Branch**: `main` (o la rama que uses), carpeta `/ (root)`
4. Guarda.
5. GitHub publicará la URL del sitio.

## 4) Conexión y modelo de datos

La app consulta y actualiza tablas existentes en Supabase:
- `members`
- `drink_options`
- `food_options`
- `orders`
- `settings`

Operaciones usadas:
- Lecturas con `supabase.from('tabla').select()`
- Escrituras con `insert()` y `update()`

## 5) Lógica de planificación de pedidos (hora local de España)

La app determina automáticamente la fecha efectiva del pedido usando la hora local de España (`Europe/Madrid`):

- **00:00 a 09:29** → se puede crear/editar el **pedido para hoy**.
- **09:30 a 12:59** → **franja de bloqueo**: no se pueden crear ni modificar pedidos.
- **13:00 a 23:59** → se puede crear/editar el **pedido para mañana**.

Comportamiento asociado:

- En el formulario se muestra la fecha efectiva (hoy o mañana).
- Si está en franja de bloqueo, todos los campos editables y el guardado quedan desactivados.
- El resumen también usa la fecha efectiva:
  - antes de 09:30: resumen de hoy
  - de 09:30 a 13:00: resumen de hoy (con aviso de bloqueo)
  - desde 13:00: resumen de mañana

## 6) Ajustes de horarios

Se reemplaza el ajuste único `cutoff_time` por dos ajustes:

- `current_day_cutoff` (por defecto `09:30`)
- `next_day_opening` (por defecto `13:00`)

### Migración SQL mínima (si tu tabla `settings` solo tiene `cutoff_time`)

```sql
alter table settings add column if not exists current_day_cutoff time;
alter table settings add column if not exists next_day_opening time;

update settings
set current_day_cutoff = coalesce(current_day_cutoff, cutoff_time, '09:30'::time),
    next_day_opening = coalesce(next_day_opening, '13:00'::time);
```

## Aviso importante de seguridad

Esta app **no tiene autenticación real**. Solo protege vistas con PIN (modelo de confianza interna). No usar como sistema de seguridad fuerte.
