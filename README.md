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

## Aviso importante de seguridad

Esta app **no tiene autenticación real**. Solo protege vistas con PIN (modelo de confianza interna). No usar como sistema de seguridad fuerte.
