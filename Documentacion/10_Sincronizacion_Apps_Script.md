# 10 · Sincronización automática con Apps Script

Cómo hacer que lo que entra a `main` acabe **dentro del proyecto de Apps Script** sin que
nadie copie y pegue nada. Este documento es la instalación (se hace una vez) y el
diagnóstico (se lee cuando el flujo se pone en rojo).

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

### 2.2 Generar las credenciales en tu máquina

En la PC, no en GitHub:

```powershell
npm install --global @google/clasp@3.3.0
clasp login
```

`clasp login` abre el navegador y pide autorizar. Al terminar deja un archivo:

| Sistema | Ruta |
| --- | --- |
| Windows | `C:\Users\<usuario>\.clasprc.json` |
| macOS / Linux | `~/.clasprc.json` |

Ábrelo y **copia todo el contenido**, desde la primera `{` hasta la última `}`.

> Usa la misma cuenta que autorizaste en 2.1. Si haces `clasp login` con una cuenta y
> activas la API con otra, todo parece bien hasta que el push falla.

### 2.3 Crear el secreto en GitHub

En **Settings → Secrets and variables → Actions → New repository secret**:

| Nombre | Valor | ¿Obligatorio? |
| --- | --- | --- |
| `CLASPRC_JSON` | El contenido íntegro de `.clasprc.json` | **Sí** |
| `APPS_SCRIPT_DEPLOYMENT_ID` | El ID del despliegue de producción | No — ver §4 |

Con `CLASPRC_JSON` puesto, el flujo ya funciona. Pruébalo sin esperar a un cambio real:
**Actions → Publicar en Apps Script → Run workflow**.

---

## 3. Lo que hay que tener presente

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
   hasta que se crea una versión nueva. Eso es el §4.

4. **El repositorio es público; el secreto no.** GitHub nunca muestra un secreto en los
   registros ni se lo entrega a un pull request que venga de un *fork*, y este flujo solo
   se dispara en `push` a `main` y a mano. Pero quien tenga permiso de escritura sí podría
   añadir un workflow que lo imprima: el secreto vale exactamente lo que valga la lista de
   colaboradores del repo.

---

## 4. El despliegue de producción (opcional)

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

## 5. Cuando falla

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

## 6. Qué toca revisar cada tanto

- **La versión de clasp está clavada en `3.3.0`** dentro del workflow, a propósito: entre
  la 2.x y la 3.x cambiaron el formato de credenciales y el nombre de la mitad de los
  comandos. Subirla es una decisión consciente, no algo que deba pasar solo.
- **El token no caduca por calendario**, pero sí muere si se revoca el acceso o si se
  cambia la contraseña de la cuenta. Cuando eso pase, el síntoma es `invalid_grant` (§5).

---

> Documento añadido en agosto de 2026, al automatizar la publicación.
