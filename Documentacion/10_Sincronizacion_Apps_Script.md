# 10 · Sincronización automática con Apps Script

Cómo hacer que lo que entra a `main` acabe **dentro del proyecto de Apps Script** sin que
nadie copie y pegue nada. Este documento es la instalación (se hace una vez) y el
diagnóstico (se lee cuando el flujo se pone en rojo).

El motivo de fondo: hasta ahora publicar exigía estar en la PC, porque el `clasp push` lo
hacía una persona. Con esto, publicar deja de depender de dónde estés. Una corrección
escrita desde el móvil en github.com llega a Apps Script sola — ver el §3, que es el que
interesa si no siempre tienes la computadora a mano.

> **Cambio del 23/09/2026 (Fase 1 del doc 16):** donde este documento dice que clasp sube `Carpeta del proyecto`, ahora sube `build/`.
> - El flujo corre antes `npm ci` y `node scripts/build.js`, que genera `build/` con los `.gs` sin comentarios y las mismas líneas.
> - El `scriptId` y el `.claspignore` siguen saliendo de `Carpeta del proyecto`.

---

## 1. Qué hace, exactamente

El flujo vive en [`.github/workflows/apps-script-sync.yml`](../.github/workflows/apps-script-sync.yml).

```
push a main que toque "Carpeta del proyecto/"
        │
        ▼
GitHub arranca un runner de Ubuntu
        │
        ├─ instala clasp 3.3.0
        ├─ escribe ~/.clasprc.json con el secreto CLASPRC_JSON
        ├─ clasp push --force        ← sube .gs / .html / appsscript.json
        └─ clasp deploy -i <id>      ← opcional, solo si hay un segundo secreto
```

No hace nada mágico: es el mismo `clasp push` que se haría a mano desde
`Carpeta del proyecto`, ejecutado por GitHub. El proyecto de destino es el `scriptId` que
ya está escrito en `Carpeta del proyecto/.clasp.json`; no se pasa por ningún lado más.

**Qué sube y qué no.** Lo decide `Carpeta del proyecto/.claspignore`, que ya existe y ya
excluye `.git/`, `.github/`, `.claude/`, los `.md` y los propios `.clasp.json` /
`.claspignore`. El flujo no cambia esas reglas.

**Cuándo NO corre.** Si el push a `main` solo tocó `Documentacion/`, `pruebas/` o
`Extencion para chrome/`, el flujo se salta entero. Apps Script no tiene nada que ver con
esas carpetas y no hay motivo para gastar un despliegue en ellas.

---

## 2. Instalación

Son tres cosas, en este orden. La 2.1 es la que se olvida y la que produce el error más
confuso de todos.

### 2.1 Habilitar la API de Apps Script

Con la cuenta de Google **que tenga acceso de editor al proyecto**, entra a:

> <https://script.google.com/home/usersettings>

y pon **«API de Google Apps Script»** en *Activada*.

Es un interruptor por **usuario**, no por proyecto. Sin él, `clasp push` responde
`User has not enabled the Apps Script API` y no hay nada en GitHub que lo arregle.

### 2.2 Generar las credenciales

Este es el **único** paso de toda la instalación que necesita una terminal. Se hace una
vez y no se repite (salvo lo del §7). Hay dos caminos y el segundo no requiere PC.

**Camino A — desde la PC.**

```powershell
npm install --global @google/clasp@3.3.0
clasp login
```

`clasp login` abre el navegador y pide autorizar. Al terminar deja un archivo:

| Sistema | Ruta |
| --- | --- |
| Windows | `C:\Users\<usuario>\.clasprc.json` |
| macOS / Linux | `~/.clasprc.json` |

**Camino B — desde el navegador, sin PC.** Google Cloud Shell es una terminal Linux
gratuita que corre en el navegador y funciona igual desde una tablet o un móvil:

> <https://shell.cloud.google.com>

Dentro, y con la misma cuenta de Google del §2.1:

```bash
npm install --global @google/clasp@3.3.0
clasp login --no-localhost   # imprime una URL, la abres y pegas el código de vuelta
cat ~/.clasprc.json
```

`--no-localhost` existe justo para esto: no levanta un servidor local, te da una URL y
espera a que le pegues el código. Es el flujo pensado para máquinas sin navegador propio.

En cualquiera de los dos caminos, el resultado es el mismo archivo. Ábrelo y **copia todo
el contenido**, desde la primera `{` hasta la última `}`.

> Usa la misma cuenta que autorizaste en 2.1. Si haces `clasp login` con una cuenta y
> activas la API con otra, todo parece bien hasta que el push falla.

### 2.3 Crear el secreto en GitHub

En **Settings → Secrets and variables → Actions → New repository secret**:

| Nombre | Valor | ¿Obligatorio? |
| --- | --- | --- |
| `CLASPRC_JSON` | El contenido íntegro de `.clasprc.json` | **Sí** |
| `APPS_SCRIPT_DEPLOYMENT_ID` | El ID del despliegue de producción | No — ver §5 |

Con `CLASPRC_JSON` puesto, el flujo ya funciona. Pruébalo sin esperar a un cambio real:
**Actions → Publicar en Apps Script → Run workflow**.

---

## 2 bis. Publicar sin ningún secreto (desde tu equipo)

Si no quieres dar de alta `CLASPRC_JSON`, **puedes publicar igual** — pero no desde
GitHub. Conviene entender por qué, porque no es una limitación de este repositorio:

> `clasp push` habla con la API de Apps Script de Google, y esa API exige un token OAuth
> de la cuenta dueña del script. El runner de GitHub arranca limpio: sin navegador y sin
> sesión de Google. Para que publique desde ahí, alguien tiene que dejarle la credencial
> guardada, y eso es exactamente lo que es un secreto. **No existe una forma de publicar
> desde GitHub sin credencial**; lo único que se puede elegir es dónde vive.

La alternativa real es publicar desde una máquina que **ya** tenga la sesión iniciada —la
tuya—. Ahí la credencial ya está (`~/.clasprc.json`, que te dejó `clasp login`), así que
no hay nada que guardar en ningún lado.

### A mano, cuando quieras

```bash
./scripts/publicar.sh
```

Comprueba que clasp está instalado, que hay sesión y que estás en el repositorio, y sube
exactamente lo mismo que subiría el flujo de GitHub (las reglas de qué sube y qué no
salen del mismo `.claspignore`, para que local y CI no puedan divergir).

Para actualizar además la URL de producción (`/exec`):

```bash
./scripts/publicar.sh <deploymentId>     # el id sale de: clasp list-deployments
```

### Que ocurra solo

```bash
./scripts/instalar-hook.sh
```

Instala un hook `post-merge`: cada `git pull` o merge **en `main`** que traiga cambios de
`Carpeta del proyecto/` publica solo. En otras ramas no hace nada —publicar desde una
rama de trabajo pisaría el proyecto con código a medio revisar— y si la publicación
falla, avisa pero no rompe el `pull`.

Es opt-in porque los hooks no se versionan: nadie se encuentra con que su equipo publica
solo sin haberlo pedido. Para quitarlo, `rm .git/hooks/post-merge`.

### Qué pasa mientras tanto en GitHub

El flujo de Actions **ya no se pone en rojo** cuando falta el secreto. Se salta la
publicación, deja un aviso y escribe en el resumen del job que ese merge *no* llegó a
Apps Script, con las dos formas de publicarlo. Un rojo permanente que no depende del
commit no es una señal: es ruido que enseña a ignorar CI.

Lo que **no** desaparece es el hecho de fondo: si publicas solo desde tu equipo, `main` y
el proyecto de Apps Script están sincronizados únicamente cuando tú lo hagas. Ese es el
precio de no tener el secreto, y es una decisión legítima —solo conviene tomarla a
sabiendas—.

---

## 3. Editar desde GitHub, sin tocar la PC

Este es el caso que justifica el flujo. El hook `Stop` del escritorio solo funciona cuando
estás en el escritorio; el flujo de GitHub funciona siempre, porque **se dispara con
cualquier push a `main`, venga de donde venga**. Un commit hecho en github.com desde el
móvil es un push a `main` exactamente igual que uno del hook.

### 3.1 Las tres formas de editar sin PC

| Cómo | Para qué sirve | Límite |
| --- | --- | --- |
| **github.com** → abrir el archivo → el lápiz → *Commit changes* | Un retoque puntual: una constante, un texto, un correo en una lista | Un archivo por commit |
| **github.dev** → abrir el repo y pulsar `.` (o cambiar `.com` por `.dev` en la URL) | VS Code entero en el navegador. Varios archivos, buscar y reemplazar, ver el diff antes de guardar | Va justo en pantalla de móvil; en tablet va bien |
| **Actions → Publicar en Apps Script → Run workflow** | Reintentar la publicación sin cambiar nada (por ejemplo, si falló por un corte de Google) | No edita nada, solo republica lo que ya está en `main` |

Al confirmar el commit, mira la pestaña **Actions**: en menos de un minuto aparece la
ejecución y, si sale en verde, el código ya está en Apps Script.

### 3.2 El detalle que sí muerde: la PC se queda atrás

Si editas en GitHub, tu copia del escritorio deja de estar al día. La próxima vez que
abras la PC, el hook `Stop` hará `git add -A`, `commit` y `push origin main` sobre una
copia que **no tiene** lo que escribiste desde el móvil. Hay dos finales posibles y
ninguno es bueno por accidente:

- Si el hook hace un `push` normal, **Git lo rechaza** (`non-fast-forward`) y el trabajo de
  esa sesión se queda sin publicar. Molesto, pero recuperable.
- Si el hook hace `push --force`, **borra en silencio** lo que editaste desde el móvil. Eso
  no se recupera solo.

El arreglo es una línea, dentro de `~/.claude/hooks/auto-push-proyecto.ps1` (está fuera del
repo, así que hay que editarlo a mano), **antes** del `push`:

```powershell
git -C $repo pull --rebase origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "El rebase choco: hay cambios hechos en GitHub. Resuelvelos a mano; no publico."
    exit 1
}
```

Con eso, el hook se pone al día antes de publicar en vez de pelearse. Y si el rebase
choca de verdad (el mismo archivo tocado en los dos lados), se detiene y avisa en lugar de
elegir un ganador por su cuenta.

**Regla práctica, más barata que cualquier script:** cuando vuelvas a la PC después de
haber editado desde el móvil, lo primero es `git pull`. Antes de abrir nada.

### 3.3 Los finales de línea, ojo

El repo usa `-text` en `.gitattributes` a propósito (ver el README): Git no normaliza
CRLF/LF, cada archivo conserva lo que trae. El editor web de GitHub no tiene por qué
respetar esa convención. Si guardas desde el móvil un archivo que venía con CRLF y vuelve
con LF, el commit sale con **todas** las líneas marcadas como modificadas: el cambio real
queda enterrado y cualquier rama abierta sobre ese archivo entra en conflicto.

No rompe nada en Apps Script — a Apps Script los finales de línea le dan igual —, pero
ensucia el historial. Antes de confirmar, mira el diff que GitHub enseña: si aparece el
archivo entero en verde y rojo, es esto. En github.dev el problema no se da.

---

## 4. Lo que hay que tener presente

Cuatro consecuencias reales de encender esto. Ninguna es un fallo; todas han mordido a
alguien alguna vez.

1. **`clasp push --force` pisa el proyecto remoto.** Si alguien editó código directamente
   en el editor de Apps Script y no lo bajó al repo, el siguiente push a `main` se lo
   lleva por delante. La regla que se deriva: **el repo es la fuente de verdad**. Si tocas
   algo en el editor web, `clasp pull` inmediatamente y súbelo, o dalo por perdido.

2. **Aquí sigue sin haber borradores, y ahora llegan a producción.** La regla 8 de
   [`00_README_Inicio.md`](00_README_Inicio.md) ya avisaba de que el hook `Stop` publica en
   `main` cualquier cambio a medias. Antes eso solo ensuciaba el historial. Con este flujo,
   un cambio a medias entra al proyecto de Apps Script. Si trabajas en algo que no debe
   verse todavía, hazlo en una rama y fusiona cuando esté.

3. **Push ≠ despliegue.** `clasp push` actualiza el código y la URL `/dev` al instante. La
   URL `/exec` que usa la gente sigue sirviendo la versión congelada de su despliegue
   hasta que se crea una versión nueva. Eso es el §5.

4. **El repositorio es público; el secreto no.** GitHub nunca muestra un secreto en los
   registros ni se lo entrega a un pull request que venga de un *fork*, y este flujo solo
   se dispara en `push` a `main` y a mano. Pero quien tenga permiso de escritura sí podría
   añadir un workflow que lo imprima: el secreto vale exactamente lo que valga la lista de
   colaboradores del repo.

---

## 5. El despliegue de producción (opcional)

El manifiesto declara `"executeAs": "USER_DEPLOYING"` y `"access": "DOMAIN"`. La gente
entra por una URL `/exec`, que apunta a un **despliegue**, y un despliegue apunta a una
**versión congelada** del código. Subir código no la mueve.

Si quieres que el flujo también mueva esa versión:

```
clasp list-deployments
```

desde `Carpeta del proyecto`. Copia el ID del despliegue de producción (empieza por `AKfyc…`)
y guárdalo como secreto `APPS_SCRIPT_DEPLOYMENT_ID`. A partir de ahí, cada push crea una
versión nueva y apunta ese despliegue a ella.

Si **no** defines el secreto, el paso se salta y lo escribe en el registro. Es la opción
prudente: el código nuevo queda listo para probar en `/dev`, y la publicación a producción
la haces tú cuando toque.

---

## 6. Cuando falla

Busca el mensaje en la columna izquierda. El registro está en **Actions → Publicar en
Apps Script →** la ejecución en rojo.

| Mensaje | Qué pasó | Arreglo |
| --- | --- | --- |
| `Falta el secreto CLASPRC_JSON` | El secreto no existe o está vacío | §2.3 |
| `CLASPRC_JSON no es un JSON valido` | Se pegó cortado o con espacios de más | Vuelve a copiar el archivo entero, de `{` a `}` |
| `User has not enabled the Apps Script API` | El interruptor por usuario está apagado | §2.1, y confirma que es **la misma cuenta** del `clasp login` |
| `Invalid credentials` / `invalid_grant` | El token dejó de valer: se cambió la contraseña, se revocó el acceso, o pasaron meses sin usarlo | `clasp login` otra vez y actualiza el secreto |
| `Requested entity was not found` | El `scriptId` de `.clasp.json` no existe o la cuenta no lo ve | Comprueba el ID y que esa cuenta sea editora del proyecto |
| `403` al desplegar | `APPS_SCRIPT_DEPLOYMENT_ID` no pertenece a este script | `clasp list-deployments` y corrige el secreto |
| Falla y no ves por qué | — | El paso *Comprobar la sesión de Google* dice con qué cuenta entró. Suele ser eso. |

**Rueda de auxilio.** Si el flujo está roto y hay que publicar ya, nada de esto bloquea el
camino manual: desde `Carpeta del proyecto`, `clasp push` y a otra cosa. El flujo es una
comodidad, no un cuello de botella.

---

## 7. Qué toca revisar cada tanto

- **La versión de clasp está clavada en `3.3.0`** dentro del workflow, a propósito: entre
  la 2.x y la 3.x cambiaron el formato de credenciales y el nombre de la mitad de los
  comandos. Subirla es una decisión consciente, no algo que deba pasar solo.
- **El token no caduca por calendario**, pero sí muere si se revoca el acceso o si se
  cambia la contraseña de la cuenta. Cuando eso pase, el síntoma es `invalid_grant` (§6).

---

> Documento añadido en agosto de 2026, al automatizar la publicación.
