# Planthy

PWA para cuidar las plantas de casa desde el iPhone. Sin dependencias ni build. Puesta en marcha en el README.

## Repos

- Este repo (`Planthy`, público): la app. Nada de datos de la casa: ni nombres de plantas, ni historial, ni el informe.
- `../planthy-data` (privado): `data.json` (lo que sincronizan los teléfonos), `docs/informe-plantas.md`, el workflow de recordatorios y los tests de aceptación.

## Publicar

- Cada push a `main` se publica solo en https://darthiss.github.io/Planthy/ (GitHub Pages desde `main`). No hay staging.
- Trabajar en una rama. Cuando el usuario pide publicar, llevar `main` a esa rama (fast-forward) y pushear.
- Antes del push: `node --test` en verde y subir `VERSION` en `sw.js` y en `js/ui/ajustes.js`. Sin eso, los teléfonos siguen con la versión vieja.
- Después: confirmar que https://darthiss.github.io/Planthy/sw.js ya sirve la versión nueva.
- Si un cambio de la app y uno de datos van juntos (por ejemplo, un id nuevo en `data.json`), primero se publica la app y después los datos: la versión vieja no entiende lo nuevo. Los teléfonos toman la versión nueva la segunda vez que abren la app.
- El workflow de `planthy-data` corre el código de `main` con el secret de las notificaciones: `main` bloquea force push y borrado.

## Cómo se trabaja

- Las reglas de cuidado salen de `docs/informe-plantas.md`. Primero se cambia el informe, después `js/rules.js` y sus tests.
- `git pull` en `planthy-data` antes de tocarlo: los teléfonos y el workflow hacen commits solos. Para cambiar datos, un script que parte del `data.json` más nuevo y pone un `t` nuevo en cada registro que toca, así gana al fusionar.
- Todo en español rioplatense, con voseo: la app, los commits y los docs.
- Probar en el navegador: `node scripts/serve.mjs` (en localhost el service worker va primero a la red).
