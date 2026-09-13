# 06 · Seguridad y permisos

Quién es quién, quién puede qué, y dónde están los candados reales. Es el documento que hay
que entender antes de tocar `Seguridad.gs`, `Permisos.gs` o `Consola.gs`.

---

## 1. El principio que ordena todo

> **El cliente propone, el servidor dispone.**

Todo lo que decide el navegador —`requireBlock()`, los filtros de menú, los botones
escondidos, `AppSession.bloques`— sirve **solo para dibujar**. `AppSession.bloques` vive en
`localStorage` y cualquiera lo edita desde la consola del navegador en diez segundos.

El candado real es **`secIdentidadConBloque_(email, bloqueId)`** (`Seguridad.gs:314`), y se
vuelve a exigir **en cada llamada al servidor**. No hay sesión de servidor que recordar: cada
`google.script.run` vuelve a resolver la identidad desde cero contra la hoja `Registros`.

**Consecuencia directa para quien mantiene:** una función nueva llamable desde el cliente
—es decir, sin `_` al final del nombre— **es pública para cualquiera que sepa su nombre**,
por muy escondido que esté su botón. Si toca datos o los modifica, su primera línea tiene
que ser el gate.

---

## 2. Los cuatro modos de autenticación

Propiedad de script **`AUTH_MODO`**. Se cambia desde Consola → Ajustes → Identidad, o con
`secFijarModoAuth(modo)` desde el editor.

| Modo | Quién decide la identidad | Cuándo usarlo |
| --- | --- | --- |
| **`portal`** *(predeterminado)* | El correo con el que se inició sesión en la app, validado contra `Registros`. Sin correo declarado, cae a la cuenta de Google | **El que está en producción.** El asesor puede tener otra cuenta de Google abierta y aun así trabajar con su usuario del portal |
| `auto` | La cuenta de Google si está registrada; si no, la del portal | Transición |
| `estricto` | **Solo** la cuenta de Google, y debe estar registrada. Ignora el portal | Máxima garantía de identidad, a costa de obligar a la cuenta correcta en el navegador |
| `legado` | Como `portal` pero sin respaldo a Google | Compatibilidad |

### El límite del modo `portal`, dicho sin adornos

En modo `portal` **el correo lo declara el navegador**. El servidor comprueba que exista en
`Registros`, pero **no puede probar que sea de quien dice ser**. Quien conozca el correo de
un compañero y sepa manipular `localStorage` puede actuar como él.

Es una decisión consciente y documentada en el propio código, tomada porque en las salas se
usan equipos compartidos y la cuenta de Google del navegador rara vez es la del asesor.

**Lo que la contiene hoy:**

- La webapp solo es accesible desde el **dominio de Liverpool** (`access: DOMAIN`).
- **Todo cambio administrativo queda en `BitacoraConsola`** con nombre y hora.
- Los datos sensibles de verdad (atenciones) tienen además su propio filtro por autor.

**Si algún día hace falta cerrar esto**, la vía es `AUTH_MODO = 'estricto'`. Cuesta que cada
asesor tenga que abrir el navegador con su cuenta corporativa, y por eso no está puesto.

---

## 3. Contraseñas y códigos

| Mecanismo | Cómo está hecho |
| --- | --- |
| Almacenamiento | **SHA-256 con sal** (`HASH_SALT`). Nunca en claro |
| Comparación | **Tiempo constante** (`secComparacionSegura_`), tanto en login como en códigos |
| Freno de fuerza bruta | **8 intentos** fallidos por correo → **15 minutos** de bloqueo. El contador vive en la caché del script, así que se limpia solo y no ensucia la hoja |
| Alta de cuenta | **No existe hasta confirmar** un código de 6 dígitos enviado al correo |
| Recuperación | Código → **vale de un solo uso** → contraseña nueva |
| Dominio permitido | `liverpool.com.mx` (`CUENTAS_DOMINIO`; `ninguno` = sin restricción) |

**Frenos del flujo de códigos**, todos del lado del servidor: 60 s entre envíos, máximo 5
códigos por hora y propósito, 5 intentos por código, código válido 10 minutos, vale válido
15 minutos.

**Dónde viven los códigos:** en las propiedades del script, **hasheados**. No en la hoja,
donde los vería cualquiera con acceso al archivo. Con seis dígitos el hash no es una barrera
criptográfica —quien tenga la sal puede probar el millón de combinaciones— pero evita que un
código quede a la vista en la pantalla de propiedades, y el acceso al editor ya implicaría
acceso total al sistema.

> **`HASH_SALT` es de solo lectura desde la consola, a propósito.** Cambiarla invalida de
> golpe la contraseña de todo el mundo. No debe estar a un clic de nadie.

---

## 4. El modelo de permisos

### 4.1 Las tres piezas

| Pieza | Qué es |
| --- | --- |
| **Bloque** | Una capacidad concreta («crear cotizaciones», «gestionar miembros»). Unidad mínima que se concede o se quita. **22 en total** |
| **Rol** | Un paquete de bloques. **3**: `normal`, `avanzado`, `maestro` |
| **Ajuste** | Concesión (`mas`) o retiro (`menos`) **por persona**, encima del rol |

Los ajustes existen para no tener que subir de rol a alguien por una sola capacidad: a un
asesor normal se le puede dejar revisar sin hacerlo supervisor, y a un supervisor se le puede
quitar el constructor de anuncios sin bajarlo de rol.

### 4.2 Orden de resolución

```
bloques del rol  →  + los de "mas"  →  − los de "menos"  →  − los módulos apagados
```

**Lo último gana.** Excepción única: **el maestro se salta el apagado de módulos**. Si apagar
un módulo por mantenimiento también dejara fuera al maestro, nadie podría volver a
encenderlo.

### 4.3 Los 24 bloques

| Grupo | `id` | Nombre en pantalla | Abre la página |
| --- | --- | --- | --- |
| **Portal** | `portal` | Portal Ventel | `portal` · **fijo** |
| | `promociones` | Monitor de promociones | `promociones` |
| **Cotizaciones** | `cotizar` | Crear cotizaciones | `cotizacion` |
| | `consultar` | Consultar cotizaciones | `consulta_cotizacion` |
| | `enviar_cotizacion` | Enviar cotizaciones | `correoventel` |
| | `correos_cliente` | Correos a clientes | `correo_cliente` |
| | `atenciones` | Atenciones pendientes | `atenciones` |
| **Supervisión** | `supervision` | Panel de supervisión | `inicio_avanzado` |
| | `revisar` | Revisar cotizaciones | `revision_cotizacion` |
| | `politica_revision` | Política de revisión | — |
| | `trazabilidad` | Trazabilidad | — |
| | `anuncios` | Anuncios del Portal | `anuncios` |
| | `portal_contenido` | Contenido del Portal | `portal_contenido` |
| | `articulos` | Publicar artículos | `articulo` |
| | `metricas` | Métricas y monitoreo | `consola` *(pestaña Métricas)* |
| | `operacion` | Estado de operación | `operacion` |
| | `sup_equipo` | Roles y accesos | `consola` |
| **Administración** *(solo maestros)* | `adm_miembros` | Miembros | **fijo** |
| | `adm_permisos` | Permisos por bloque | **fijo** |
| | `adm_ajustes` | Ajustes del sistema | **fijo** |
| | `adm_modulos` | Módulos | **fijo** |
| | `adm_formatos` | Formatos de cotización | **fijo** |
| | `adm_salud` | Salud del sistema | **fijo** |
| | `adm_bitacora` | Bitácora | **fijo** |

**«Fijo»** significa que no se puede apagar por mantenimiento: si se pudiera, la app quedaría
sin salida.

Dos decisiones de reparto que conviene entender:

- **`atenciones` va con el trabajo diario del asesor, no con supervisión.** Quien registra al
  cliente que se quedó esperando es quien lo tenía en la línea.
- **Reportar una falla NO necesita bloque.** Lo puede hacer cualquiera con sesión. Ponerle
  permiso sería pedir autorización para avisar de que algo no funciona. El bloque `operacion`
  es solo para el otro lado del mostrador: decidir qué se le dice al equipo.
- **`articulos` guarda ESCRIBIR, no leer.** Los artículos los lee cualquiera con sesión; el
  bloque abre el editor y la lista de quién los ha leído.
- **`metricas` es un bloque de supervisión, no de administración.** Un supervisor entra y ve su
  alcance jerárquico —el recorte lo hace el servidor en cada consulta, no la pantalla—; el
  maestro lo ve todo. Es la primera sección de la consola que abre un bloque que no empieza
  por `adm_`.

**Los grupos y la difusión NO tienen bloque propio, a propósito** (F9). Se gatean por **nivel**:
supervisor (2) o superior. El motivo: `sup_equipo` se le puede conceder a un asesor por excepción
para que dé de alta a quien entra el lunes, y eso no debe convertirlo en dueño de las listas de
correo de toda la empresa ni en quien puede mandarle un comunicado a cuarenta personas.

### 4.4 Los tres roles

| Rol | Nombre | Nivel | Qué incluye |
| --- | --- | --- | --- |
| `normal` | **Asesor** | 1 | `portal`, `promociones`, `cotizar`, `consultar`, `enviar_cotizacion`, `correos_cliente`, `atenciones`. **Es el rol de cualquier alta nueva** |
| `avanzado` | **Supervisor** | 2 | Todo lo anterior + `supervision`, `revisar`, `politica_revision`, `trazabilidad`, `anuncios`, `portal_contenido`, `operacion`, `sup_equipo` |
| `maestro` | **Maestro** | 3 | **Todo.** Se calcula desde la lista completa, para que nunca se quede corto al añadir un bloque |

`avanzado` da exactamente lo que daba la columna «Avanzado» = Sí, ni un bloque más ni uno
menos, para que nadie ganara ni perdiera accesos el día que se subió el modelo de bloques.

> **`nivel` y `orden` son dos campos distintos aunque hoy valgan lo mismo.** `orden` decide
> en qué posición se pinta el rol en una lista; `nivel` decide **a quién alcanza cada quien**.
> Se guardan separados para que el día que se quiera insertar un rol intermedio en la lista
> sin moverlo de jerarquía, tocar presentación no cambie en silencio una regla de seguridad.

### 4.5 Jerarquía: quién alcanza a quién

Escrita **una sola vez**, en `Permisos.gs`, y usada por toda la app:

| Regla | Función | Qué impide |
| --- | --- | --- |
| Alcanzas a quien esté en tu **mismo nivel o por debajo** — nunca a tu propia cuenta | `permVetoJerarquia_` | Que un supervisor toque a un maestro, o se edite a sí mismo |
| No puedes conceder un rol **por encima del tuyo** | `permVetoRol_` | Escalada de privilegios |
| No puedes repartir bloques **que no tienes** | `permBloquesRepartibles_` | Conceder lo que no te fue concedido |

`sup_equipo` existe precisamente por esto: permite que una coordinación dé de alta a quien
entra el lunes y de baja a quien se fue el viernes **sin despertar a un maestro**, que era el
motivo real por el que circulaban cuentas maestras de más.

### 4.5 bis · Matriz rol × función (T13.2, verificada contra el código el 12/09/2026)

La tabla de bloques (§4.3) y la de roles (§4.4) dicen lo mismo que esta matriz; esta solo las
cruza en una sola vista para no tener que sumarlas a mano. Generada leyendo `PERM_BLOQUES` y
`PERM_ROLES` de `Permisos.gs`, no a mano — si un bloque cambia de rol ahí, esta tabla queda
desactualizada y hay que rehacerla igual.

| Bloque / función | Pantalla | Asesor | Supervisor | Maestro |
| --- | --- | :---: | :---: | :---: |
| `portal` **(fijo)** | `portal` | ✔ | ✔ | ✔ |
| `promociones` | `promociones` | ✔ | ✔ | ✔ |
| `cotizar` | `cotizacion` | ✔ | ✔ | ✔ |
| `consultar` | `consulta_cotizacion` | ✔ | ✔ | ✔ |
| `enviar_cotizacion` | `correoventel` | ✔ | ✔ | ✔ |
| `correos_cliente` | `correo_cliente` | ✔ | ✔ | ✔ |
| `atenciones` | `atenciones` | ✔ | ✔ | ✔ |
| `supervision` | `inicio_avanzado` | — | ✔ | ✔ |
| `revisar` | `revision_cotizacion` | — | ✔ | ✔ |
| `politica_revision` | *(ajuste, sin pantalla propia)* | — | ✔ | ✔ |
| `trazabilidad` | *(dentro del Portal)* | — | ✔ | ✔ |
| `anuncios` | `anuncios` | — | ✔ | ✔ |
| `portal_contenido` | `portal_contenido` | — | ✔ | ✔ |
| `articulos` (escribir; leer es de todos) | `articulo` | — | ✔ | ✔ |
| `metricas` | `consola` › Métricas | — | ✔ *(alcance jerárquico recortado)* | ✔ *(todo)* |
| `operacion` (decidir qué se publica) | `operacion` | — | ✔ | ✔ |
| `sup_equipo` | `consola` › Roles | — | ✔ *(solo su nivel o por debajo)* | ✔ |
| `adm_miembros` **(fijo)** | `consola` | — | — | ✔ |
| `adm_permisos` **(fijo)** | `consola` | — | — | ✔ |
| `adm_ajustes` **(fijo)** | `consola` | — | — | ✔ |
| `adm_modulos` **(fijo)** | `consola` | — | — | ✔ |
| `adm_formatos` **(fijo)** | `consola` | — | — | ✔ |
| `adm_salud` **(fijo)** | `consola` | — | — | ✔ |
| `adm_bitacora` **(fijo)** | `consola` | — | — | ✔ |
| *Reportar una falla (sin bloque, a propósito)* | `operacion` | ✔ | ✔ | ✔ |
| *Grupos y difusión (por nivel, sin bloque propio)* | `consola` | — | ✔ *(nivel ≥ 2)* | ✔ |

**El único ajuste «solo maestro» que no es un bloque de la tabla anterior:**
`CORREO_CCO_GLOBAL` (§8 bis) — copia oculta de todo correo saliente, salvo los tres correos de
seguridad (contraseña temporal, restablecimiento, código de verificación), que **nunca** se
copian, sin excepción configurable.

**Nada de esto confía en el cliente.** Cada ✔ de esta tabla es un `secIdentidadConBloque_`
(o `secIdentidadMaestra_` en Administración) que se vuelve a exigir en el servidor en cada
llamada — la tabla describe el resultado, no la puerta. Los ajustes por persona (§4.1) pueden
mover una celda individual sin mover el rol completo; esta matriz es la BASE antes de ajustes.

**Pendiente de esta tarea, y no es de código:** la verificación con **tres cuentas de prueba
reales** (una por rol) recorriendo la app entera, que el criterio de aceptación de F13 exige
además de esta tabla — eso solo se puede hacer a mano, con sesión real de cada rol.

### 4.6 Retrocompatibilidad

Mientras alguien **no tenga fila** en `_PermisosSistema`, manda la columna `Avanzado` de
`Registros`, exactamente como antes. El sistema no cambió de comportamiento el día que se
subió el modelo de bloques: cambia cuando se usa la consola.

---

## 5. Las tres reglas de la Consola

1. **Nada se ejecuta sin gate.** Cada función resuelve la identidad y exige un bloque de
   administración concreto. *El correo que manda el navegador no es una credencial: es una
   pregunta que el servidor responde.*
2. **Nadie puede dejarse fuera.** No se puede quitar el rol maestro a uno mismo, ni darse de
   baja, ni retirar al último maestro que queda. *Un sistema de permisos que permite cerrarse
   por dentro es un sistema que un día hay que arreglar desde el editor.*
3. **Todo cambio queda apuntado** en `BitacoraConsola`. *Sin eso, «¿por qué este asesor ya no
   puede cotizar?» no tiene respuesta.*

**Si aun así nadie puede entrar**, la salida es el editor de Apps Script:
`NOMBRAR_MAESTRO()` o `permSembrarMaestro(correo)` (ver
[`09_Solucion_de_Problemas.md`](09_Solucion_de_Problemas.md) §1).

---

## 6. Superficies de ataque y cómo están cerradas

| Superficie | Riesgo | Cómo está contenido |
| --- | --- | --- |
| **Webhooks configurables** | **SSRF.** Un webhook es una URL que el *servidor* visita: dejarlo libre convierte la consola en un trampolín hacia cualquier cosa que el proyecto vea desde dentro de Google | Lista blanca de hosts: `CONSOLA_WEBHOOK_HOSTS = ['chat.googleapis.com']`. **No la amplíes sin entender esto** |
| **URL de artículo en un iframe** | Ejecución de código en la sesión de quien revisa (una celda con `javascript:…`) | `REV_HOSTS_ARTICULO`, comparando **host exacto o subdominio real, nunca `includes`** |
| **Parámetro `next` tras el login** | Redirección abierta hacia fuera del sistema | Es una **clave de página**, jamás una URL. Lista blanca `AppUrl.PAGINAS_TRAS_LOGIN` |
| **HTML de correo armado en el cliente** | Inyección en el correo que recibe el cliente | Se valida en el servidor antes de enviar; `secEscapeHtml_` para lo que se interpola |
| **Fuerza bruta en login** | Adivinar contraseñas | 8 intentos → 15 min de bloqueo |
| **Enumeración de correos** | Saber quién está dado de alta | Los mensajes de error no distinguen «no existe» de «contraseña incorrecta» |
| **Pantallas públicas** | Filtrar datos internos sin sesión | Verificado: `estado`, `portal` y `promociones` no llevan correos ni notas internas |
| **Datos de cliente en atenciones** | Exposición de teléfonos | Privado por omisión; liberación explícita; `atenVersionPublica_` recorta el pool |

---

## 7. Deuda de seguridad conocida

> **Los secretos siguen en el código fuente como respaldo.**

`Code.gs:29-30` contiene `HASH_SALT` y `WEBHOOK_URL` con valores reales. El propio comentario
del archivo lo dice: **son el respaldo**; lo que manda es la propiedad de script del mismo
nombre.

**Riesgo real:** este repositorio se publica automáticamente en `main` a cada tarea. El
webhook lleva `key` y `token` en la URL: cualquiera que los tenga puede **publicar mensajes
en el espacio de Google Chat del equipo**. La sal permitiría atacar los hashes por fuerza
bruta si alguien obtuviera además la hoja `Registros`.

**Cómo cerrarlo** (procedimiento completo en
[`07_Guia_de_Mantenimiento_y_Operacion.md`](07_Guia_de_Mantenimiento_y_Operacion.md) §7):

1. Ejecutar `secGuardarConfiguracion()` desde el editor — copia los valores a las propiedades
   del script.
2. Verificar en Configuración → Propiedades del script que están puestos.
3. **Vaciar las constantes** en `Code.gs` (dejar `""`).
4. Ejecutar `revisionMaestra()`: el check *«Seguridad · Secretos fuera del código»* tiene que
   pasar.
5. **Rotar el webhook** en Google Chat: el valor viejo ya está en el historial de git y
   vaciar la constante no lo borra de ahí.

**Prioridad: alta, y es barato.** Son cinco minutos.

---

## 8. Auditoría: qué queda registrado

| Registro | Dónde | Qué guarda |
| --- | --- | --- |
| Cambios administrativos | `BitacoraConsola` | Quién, qué, sobre quién, cuándo. Últimos 150 |
| Correos enviados | `MetricasCorreos` | Todos los envíos, los dos canales |
| Plantillas a clientes | `CorreosEnviados` | Bitácora aditiva |
| Revisiones | Columnas `Revision*` de `Cotizaciones` | Quién aprobó o rechazó, cuándo y con qué notas |
| Reportes de falla | `OperacionReportes` | Quién reportó qué y cuándo |
| Búsquedas | `MetricasBusquedas` | Qué escribió cada quien en el buscador de cotizaciones (F9) |
| Difusiones | `MetricasCorreos` + `BitacoraConsola` | Asunto, grupo y número de destinatarios (F9) |
| Errores del servidor | Cloud Logging (`STACKDRIVER`) | Excepciones con traza |
| Ejecuciones | Panel de ejecuciones de Apps Script | Quién ejecutó qué función y con qué resultado |

**No queda registrado**, y conviene saberlo: los inicios de sesión correctos, las lecturas de
datos (quién consultó qué cotización) y las ediciones hechas a mano en las hojas — para eso
está el historial de versiones de Google Sheets.

### 8 bis. La copia oculta global y los correos que NUNCA se copian

El ajuste `CORREO_CCO_GLOBAL` (solo maestro) manda copia oculta de todo lo que el sistema envía
hacia fuera: cotizaciones con PDF, plantillas a clientes, avisos de cuenta y avisos de revisión.
Es una medida de vigilancia legítima —poder releer qué se le dijo a un cliente sin pedirle la
bandeja a nadie— con **una exclusión que no es configurable**:

> Los correos de **seguridad** no se copian nunca: la contraseña temporal de bienvenida, la del
> restablecimiento y el código de verificación. Las tres llevan el secreto en el cuerpo, y
> copiarlas a un buzón compartido convertiría el monitoreo en un almacén de credenciales de
> todo el equipo.

Cómo está cerrado, y por qué así: el CCO **no** vive dentro de `cuentasEnviarCorreo_`, que es la
función que comparten los correos de seguridad y los avisos normales. Se pide ruta por ruta con
`{cco:true}`, de modo que **quien no lo pide, no lo lleva**. Falla cerrado: un correo nuevo que
alguien escriba mañana sin pensar en esto sale sin copia, que es el error inofensivo de los dos.

---

## 9. Lista de comprobación antes de exponer una función nueva

Si vas a añadir una función llamable desde el cliente:

- [ ] ¿Su primera línea resuelve identidad con `secIdentidadConBloque_` o equivalente?
- [ ] ¿El bloque que exige es el correcto, y está en `PERM_BLOQUES`?
- [ ] Si escribe: ¿invalida la caché?
- [ ] Si escribe sobre otra persona: ¿pasa por `permVetoJerarquia_`?
- [ ] Si es administrativa: ¿apunta en `BitacoraConsola`?
- [ ] ¿Valida y acota todo lo que llega del cliente (longitudes, tipos, listas cerradas)?
- [ ] Si devuelve datos de cliente: ¿los recorta para quien no es su dueño?
- [ ] Si recibe una URL: ¿la valida contra una lista blanca de hosts?
- [ ] ¿Los mensajes de error evitan revelar si un correo existe?

---

> **Creador del proyecto: David Martínez** | Asesor Ventel | Escritor
