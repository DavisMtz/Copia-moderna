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

### 4.3 Los 22 bloques

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
| Errores del servidor | Cloud Logging (`STACKDRIVER`) | Excepciones con traza |
| Ejecuciones | Panel de ejecuciones de Apps Script | Quién ejecutó qué función y con qué resultado |

**No queda registrado**, y conviene saberlo: los inicios de sesión correctos, las lecturas de
datos (quién consultó qué cotización) y las ediciones hechas a mano en las hojas — para eso
está el historial de versiones de Google Sheets.

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
