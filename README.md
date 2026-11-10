# Planthy

App para cuidar las plantas de casa desde el iPhone: qué toca hoy, el palito, el riego, el Fertifox, las fotos de progreso y los avisos. Se instala en la pantalla de inicio, funciona sin conexión y la usan dos teléfonos sobre los mismos datos.

- **Este repo (`planthy`, público):** la app, publicada con GitHub Pages. No tiene datos.
- **`planthy-data` (privado):** tus plantas, el historial, las fotos, el informe y el workflow que manda los avisos.

Sin servidor propio y gratis: cada teléfono guarda todo primero en el teléfono y lo sincroniza con `planthy-data` usando la API de GitHub.

## 1. Subir los dos repos

1. Creá en GitHub el repo **`planthy`** (público) y subí esta carpeta. El archivo `prompt-claude-code.md` está en `.gitignore` para que no se publique.
2. Creá **`planthy-data`** (privado) y subí la carpeta `planthy-data` entera. Trae `data.json` con la precarga, `docs/informe-plantas.md` y `.github/workflows/recordatorios.yml`. El archivo `vapid-private.txt` **no** se sube (está en `.gitignore`).
3. En `planthy` → Settings → Pages → Source: **Deploy from a branch** → `main` / `(root)`. En un minuto la app está en `https://<tu-usuario>.github.io/planthy/`.

## 2. Proteger la rama `main` de `planthy`

El workflow privado ejecuta el código de este repo con tus secrets, así que nadie tiene que poder cambiarlo a escondidas.

- `planthy` → Settings → Rules → Rulesets → **New branch ruleset** → Target: *Default branch* → activá **Restrict deletions**, **Block force pushes** y **Require a pull request before merging**.
- Más seguro todavía: en `planthy-data/.github/workflows/recordatorios.yml`, cambiá `APP_REF: main` por el hash de un commit que revisaste. Así el workflow corre ese código exacto hasta que lo actualices vos.

## 3. Secret de las notificaciones

1. `planthy-data` → Settings → Secrets and variables → Actions → **New repository secret**.
2. Nombre: `VAPID_PRIVATE_KEY`. Valor: el contenido de `planthy-data/vapid-private.txt`.
3. Borrá `vapid-private.txt` de la compu.

La clave pública ya está en `data.json` (`settings.vapidPublic`). Para generar un par nuevo: `node scripts/vapid.mjs`. Ojo: con un par nuevo, cada teléfono tiene que volver a activar las notificaciones.

## 4. El token (uno solo para los dos teléfonos)

GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token:

- **Expiration:** 1 año.
- **Repository access:** *Only select repositories* → `planthy-data`.
- **Permissions → Repository → Contents:** *Read and write*. Nada más.

El token queda solo en cada teléfono. La app te avisa dos semanas antes de que venza (usa la fecha que cargás al conectar) y también si GitHub lo rechaza. Cuando venza, generá uno nuevo y pegalo en Ajustes → Sincronización, en los dos teléfonos.

## 5. Instalar en el iPhone

1. Abrí `https://<tu-usuario>.github.io/planthy/` en **Safari**.
2. Compartir → **Agregar a inicio**.
3. Abrí Planthy desde el ícono y seguí los pasos: tu nombre → usuario, `planthy-data` y token → llegan las 10 plantas → notificaciones.

Hacé lo mismo en el teléfono de tu pareja, con su nombre y el mismo token. Lo que anota uno aparece en el otro al abrir la app (y cada dos minutos si está abierta).

La app instalada guarda sus datos aparte de Safari. Si borrás el ícono se borran los datos de ese teléfono; lo sincronizado sigue en el repo.

## 6. Notificaciones

- Activalas desde la app (Ajustes → Avisos → **Activar notificaciones**) en cada teléfono. iOS pide permiso con un toque.
- El workflow `Recordatorios` de `planthy-data` corre cada hora de 7 a 22 (hora de Argentina) y manda **un aviso por día** cuando ya pasó la hora configurada en Ajustes (9:00 por defecto), solo si toca algo. Por ejemplo: “Domingo de plantas: 5 para revisar, cambio de agua y 1 con Fertifox”. Al tocarlo, abre Hoy.
- **Probar:** `planthy-data` → Actions → Recordatorios → **Run workflow** → `prueba` (manda “Las notificaciones funcionan”). `simular` muestra en el log el aviso de hoy sin mandarlo; `forzar` lo manda aunque no sea la hora.

Límites de iOS y de GitHub que conviene saber:

- Solo funcionan con la app **instalada** en la pantalla de inicio, en iOS 16.4 o más nuevo. Desde una pestaña de Safari, no.
- iOS no deja que una web app programe avisos locales ni que corra en segundo plano: por eso el aviso lo manda GitHub.
- Los cron de GitHub Actions a veces se atrasan bastante o se saltean una vuelta. Como corre cada hora, la vuelta siguiente lo manda igual.
- Si rechazás el permiso, se reactiva en Ajustes del iPhone → Notificaciones → Planthy.
- **Alternativa que siempre avisa a horario:** Calendario → **Agregar al Calendario del iPhone**. Un archivo con los domingos y el 1.er domingo (se agrega una vez) y otro con los re-chequeos y tareas con fecha (se vuelve a agregar cuando hay nuevos).

## Tus datos

Ajustes → **Exportar todo** arma un `.zip` con `planthy.json` y todas las fotos. **Importar** lo suma a lo que haya en el teléfono, sin borrar nada. Sirve para pasar todo a otro teléfono o guardar una copia aparte del repo.

## Publicar cambios

Editá los archivos y subí a `planthy`. Cambiá `VERSION` en `sw.js` (por ejemplo `planthy-v1.0.1`): los teléfonos bajan la versión nueva completa y la usan la próxima vez que abren la app.

## Para desarrollar

```
node scripts/serve.mjs        # la app en http://localhost:8080 (sin caché)
node --test                   # reglas, fusión, cifrado del push
cd ../planthy-data && node --test   # criterios de aceptación contra la precarga real
```

Sin dependencias ni build. Las reglas del informe viven en `js/rules.js` y las usan igual la app y el script de avisos (`scripts/recordatorios.mjs`).
