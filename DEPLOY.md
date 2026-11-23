# Publicar el planner gratis (GitHub Pages + Supabase)

Al terminar vas a tener una dirección como `https://TU-USUARIO.github.io/day-planner/`
que abrís desde el celu o la compu, desde cualquier lado. La compu puede estar apagada.

- **GitHub Pages** publica la app (`docs/`). Es gratis.
- **Supabase** es una base de datos Postgres donde se guardan los eventos. El plan Free es gratis.

> Sin login: cualquiera que tenga la dirección puede ver y editar los eventos.

---

## 1. Crear la base de datos en Supabase (≈5 min)

1. Entrá a <https://supabase.com> → **Start your project** y creá una cuenta. Podés entrar con GitHub.
2. Creá un proyecto con **New project**:
   - Name: `day-planner`
   - Database password: inventá una y guardala. La app no la usa.
   - Region: la más cercana, por ejemplo *South America (São Paulo)*.
   - Plan: **Free**.
3. Cuando termine de crearse, andá a **SQL Editor → New query**. Pegá todo el contenido de
   [`supabase/setup.sql`](supabase/setup.sql) y tocá **Run**. Tiene que decir *Success*.
4. Copiá los dos datos de conexión. Están en el botón **Connect** o en **Project Settings → API Keys / Data API**:
   - **Project URL**, por ejemplo `https://abcdefghijkl.supabase.co`
   - **Publishable key** (`sb_publishable_...`). Si tu proyecto muestra claves "legacy", sirve la **anon public**.
   - ⚠️ No uses la **secret** ni la **service_role** key.
5. Pegalos en [`docs/config.js`](docs/config.js):

   ```js
   window.PLANNER_CONFIG = {
     supabaseUrl: 'https://abcdefghijkl.supabase.co',
     supabaseKey: 'sb_publishable_xxxxxxxxxxxx',
   };
   ```

6. Pasá tus eventos actuales (`data/events.json`) a Supabase:

   ```powershell
   npm run import
   ```

   Lo podés correr más de una vez sin que se dupliquen.

## 2. Subir el código a GitHub

1. En <https://github.com/new> creá un repositorio:
   - Repository name: `day-planner`
   - **Public**. GitHub Pages es gratis solo con repos públicos.
   - No marques "Add a README" ni nada más: el repo tiene que quedar vacío.
2. En PowerShell, dentro de la carpeta del proyecto, cambiá `TU-USUARIO` y corré:

   ```powershell
   git remote add origin https://github.com/TU-USUARIO/day-planner.git
   ```

   ```powershell
   git add -A
   ```

   ```powershell
   git commit -m "Configure Supabase"
   ```

   ```powershell
   git push -u origin main
   ```

   Si Git te pide iniciar sesión, se abre una ventana de GitHub. Aceptá.

   `data/` está en `.gitignore`, así que tus eventos locales no se suben. Solo se sube el código.

## 3. Activar GitHub Pages

1. En el repo: **Settings → Pages**.
2. En **Build and deployment → Source** elegí **Deploy from a branch**.
3. Branch: **main**, carpeta **/docs** → **Save**.
4. Esperá 1–2 minutos y recargá la página de Settings. Arriba va a aparecer:
   *"Your site is live at https://TU-USUARIO.github.io/day-planner/"*.

## 4. En el iPhone

1. Abrí esa dirección en **Safari**.
2. Tocá **Compartir → Agregar a inicio**. Queda como una app.

---

## Cambios futuros

Cada vez que cambies algo en el código:

```powershell
git add -A
```

```powershell
git commit -m "Describe the change"
```

```powershell
git push
```

GitHub Pages se actualiza solo en 1–2 minutos.

## Cosas a saber

- **Supabase pausa los proyectos Free que pasan una semana sin uso.** Si un día la app muestra
  "Offline — can't reach server", entrá a supabase.com y tocá **Restore project** (o *Resume*).
  Tus datos no se borran.
- **Ver o editar los datos a mano:** Supabase → **Table Editor → events**.
- **Backup:** Table Editor → events → **Export → CSV**.
- **Volver al modo local** (servidor en tu compu con `npm start`): dejá vacíos los dos valores de
  `docs/config.js`.
