# Frontend — Referencia Técnica Detallada de Componentes y Vistas

> **DOCUMENTACIÓN TÉCNICA OFICIAL DE ARQUITECTURA Y MANTENIMIENTO**
> **Sistema Integral Portal Ventel & Extensión Chrome**
> **Autor:** David Martínez (`dmartineza02@liverpool.com.mx`)

---

## 🎨 Especificación de Objetos y APIs Globales del Cliente

Esta sección contiene la referencia técnica completa de los objetos JavaScript expuestos en el ámbito global (`window`) a través de las plantillas del frontend.

---

### 📄 1. `app_core.html` — Núcleo Cliente

#### `window.AppSession` (Gestión de Sesión e Identidad)
- `userName`: `string` — Nombre completo del usuario (`localStorage` bajo `ventel-user-name`).
- `userEmail`: `string` — Correo electrónico normalizado (`localStorage` bajo `ventel-user-email`).
- `isAdvanced`: `boolean` — Banderola legacy de usuario avanzado.
- `firstName`: `string` — Primer palabra del nombre o `'Usuario'`.
- `rol`: `'normal' | 'avanzado' | 'maestro'` — Rol jerárquico activo.
- `isMaster`: `boolean` — `true` si `rol === 'maestro'`.
- `bloques`: `string[]` — Arreglo de identificadores de bloques de permisos otorgados por el servidor.
- `can(bloqueId: string): boolean` — Permisivo. Retorna `true` si posee el bloque o si los bloques aún no han sido cargados.
- `canStrict(bloqueId: string): boolean` — Estricto. Retorna `false` si los bloques no han sido confirmados. Usado en consola y administración.
- `refrescar(): Promise<Object|null>` — Invoca el backend (`obtenerPermisosSesion`) para actualizar roles y bloques. Si la cuenta fue dada de baja (`activo === false`), limpia la sesión y redirige a `login`.
- `save(data: Object): void` — Persiste nombre, correo, rol y bloques en `localStorage`.
- `clear(): void` — Limpia datos de identidad en `localStorage` preservando la configuración visual del usuario (tema, escala de texto).

#### `window.AppUrl` (Enrutamiento e Iframe Navigation)
- `PAGINAS`: `string[]` — Lista blanca de páginas válidas (`login`, `registro`, `recuperar`, `dashboard`, `inicio_avanzado`, `cotizacion`, `cotizado_preview`, `consulta_cotizacion`, `revision_cotizacion`, `correoventel`, `correo_cliente`, `anuncios`, `portal_contenido`, `operacion`, `consola`, `atenciones`).
- `build(page: string, params?: Object, ancla?: string): string|null` — Construye URLs con parámetros normalizados en `URLSearchParams`, filtrando parámetros de rastreo (`PARAMS_BASURA`).
- `go(page: string, params?: Object, ancla?: string): boolean` — Redirige el marco superior (`window.top.location.href`). Si la API `navigator.userActivation` ha expirado (más de 5s tras un clic durante operaciones asíncronas), muestra el banner **`NavAviso`** con enlace directo manual.
- `param(name: string): string` — Lee parámetros inyectados por el servidor en `window.__APP__` o de `window.location.search`.
- `actualizar(params: Object, ancla?: string, apilar?: boolean): boolean` — Actualiza la barra de direcciones sin recargar la página mediante `google.script.history`.
- `irAncla(nombre?: string, intentos?: number): void` — Desplazamiento suave hacia un elemento por ID con animación de resplandor.

#### `window.AppCache` & `AppCache.session` (Almacenamiento Local)
- `get(name: string, maxAgeMs?: number): {data: any, ageMs: number, at: number}|null` — Recupera datos de `localStorage` verificando vigencia.
- `set(name: string, data: any, opts?: {ttl: number}): boolean` — Almacena datos JSON con prefijo `ventel-cache-`.
- `removeByPrefix(prefijo: string): number` — Invalida familias de claves (ej. `quotes-`).
- `purgeExpired(): void` — Limpia claves obsoletas o con esquema de versión anterior.

#### `window.AppBusy` (Indicador de Carga Global)
- `start(etiqueta?: string): number` — Incrementa el contador de llamadas activas y muestra el anillo de puntos de Liverpool. Retorna un token de seguimiento.
- `done(token: number): void` — Decrementa el contador y oculta el anillo al llegar a cero.
- `wrap(promesa: Promise, etiqueta?: string): Promise` — Envuelve una promesa mostrando el indicador durante su ejecución.

#### `window.AppRun` (Wrapper Async para `google.script.run`)
- `call(fnName: string, args?: any[], opts?: {key?: string, busy?: boolean|string}): Promise<any>` — Ejecuta llamadas de servidor deduplicando peticiones idénticas en vuelo.
- `swr(cacheName: string, fnName: string, args?: any[], opts: {onData: Function, ttl?: number, fuerza?: boolean}): Promise<any>` — Implementa el patrón Stale-While-Revalidate: llama a `onData` inmediatamente con la caché local y vuelve a llamarlo al recibir los datos frescos del servidor.

---

### 📄 2. `app_shell.html` — Layout Maestro

#### `window.AppShell`
- `mount(opts?: {active?: string, title?: string}): void` — Envuelve el contenido principal (`#main-content`) dentro del layout corporativo, construye la barra superior (`topbar`), la barra lateral (`sidebar`) y aplica las preferencias de vista guardadas.
- `nav(page: string): void` — Navegación inteligente. Si el destino es `atenciones`, abre un panel lateral superpuesto (`AppAtenciones.abrirPanel()`) sin recargar la página.
- `logout(): void` — Cierra sesión y redirige a `login`.
- `toggleDrawer(): void` — Conmuta la visibilidad del menú lateral en dispositivos móviles.
- `setTheme(name: 'aurora'|'slate'|'carbon'): void` — Cambia el atributo `data-theme` en la etiqueta `<html>`.
- `setDensity(mode: 'cozy'|'compact'): void` — Cambia el atributo `data-density`.
- `setTextScale(scale: 'sm'|'md'|'lg'|'xl'): void` — Cambia el atributo `data-textscale`.
- `toggleContrast(): void` — Conmuta el atributo `data-contrast="high"`.

---

### 📄 3. `app_auth.html` — Componentes de Autenticación

#### `window.AuthStage`
- `paint(): void` — Inyecta el logotipo vectorial SVG de Liverpool en elementos `[data-liv]`.
- `play(opts?: {title?: string}): void` — Ejecuta la secuencia de animación GSAP (trazo DrawSVG de logotipo, entrada de tarjeta, revelado de formulario y efecto parallaje con puntero).
- `paso(sel: string|HTMLElement, paso: number): void` — Actualiza la barra de progreso de pasos (`auth-steps`), sustituyendo números por palomitas SVG en pasos completados.
- `cuenta(el: HTMLElement, segundos: number, opts?: Object): Object` — Inicia un contador regresivo `mm:ss` para el reenvío de códigos OTP.

#### `window.AuthOtp` (Widget de Código OTP de 6 Celdas)
- `mount(root: HTMLElement, opts?: {longitud?: number, onComplete?: Function}): Object` — Renderiza 6 cajas de texto independientes. Distribuye códigos pegados completos, navega con flechas/backspace, limita entradas a dígitos numéricos y ejecuta animación de agitación (`shake`) ante errores.

---

### 📄 4. `app_comando.html` — Paleta de Comandos (`Ctrl+K`)

#### `window.AppComando`
- `abrir(termino?: string): void` — Abre la paleta de comandos animando su geometría desde el botón detonador mediante técnica GSAP FLIP (First, Last, Invert, Play) con contra-escala inversa (`1 / scale`) para evitar distorsionar el texto.
- `cerrar(instantaneo?: boolean): void` — Cierra el modal.
- `refrescar(): void` — Re-indiza los catálogos locales y actualiza la lista de resultados.

---

### 📄 5. `app_operacion.html` — Isla Dinámica e Indicador de Salud

#### `window.AppOperacion`
- `abrir(): void` — Abre el panel lateral desplegable con el detalle de salud de los sistemas.
- `reportar(sistema?: string): void` — Abre el panel directamente en el formulario de reporte de fallas.
- `refrescar(forzar?: boolean): void` — Re-consulta el estado del servidor (`opEstadoSesion`).
- `alCambiar(cb: Function): Function` — Registra un listener de cambio de estado. Invoca el callback inmediatamente con los datos actuales.

---

### 📄 6. `app_buscar.html` — Motor de Búsqueda Tokenizado

#### `window.AppBuscar`
- `normaliza(s: any): string` — Convierte a minúsculas, descompone acentos NFD y elimina puntuación.
- `compacta(s: any): string` — Remueve todos los caracteres no alfanuméricos (para folios `lvp202601`).
- `palabras(norm: string): string[]` — Tokeniza texto separando transiciones entre letras y números.
- `consulta(q: string): Object` — Construye un objeto de consulta enriquecido con expansión de sinónimos.
- `filtra(lista: Array, termino: string, camposFn: Function, opts?: Object): Array` — Filtra y ordena un arreglo por puntuación de relevancia.
- `resalta(texto: string, termino: string): string` — Retorna cadenas HTML envolviendo coincidencias en etiquetas `<mark>`.

---

## 🎨 Paleta de Variables y Tokens CSS (`app_theme.html`)

```css
:root {
  /* Tipografías */
  --fuente: 'Inter', system-ui, -apple-system, sans-serif;
  --mono: 'JetBrains Mono', monospace;

  /* Tema Aurora (Predeterminado) */
  --bg: #F8FAFC;
  --surface: #FFFFFF;
  --surface2: #F1F5F9;
  --line: #E2E8F0;
  --ink: #0F172A;
  --inkSoft: #475569;
  --inkFaint: #94A3B8;

  /* Liverpool Corporate Brand Tokens */
  --brand: #E10098;
  --brandDeep: #C20083;
  --brandTint: #FDF2F8;

  /* Estados */
  --ok: #10B981;
  --okTint: #ECFDF5;
  --warn: #F59E0B;
  --warnTint: #FFFBEB;
  --alert: #EF4444;
  --alertTint: #FEF2F2;
}

/* Override Tema Carbon (Dark Mode) */
html[data-theme="carbon"] {
  --bg: #0E1014;
  --surface: #161920;
  --surface2: #212631;
  --line: #2E3545;
  --ink: #F8FAFC;
  --inkSoft: #94A3B8;
  --inkFaint: #64748B;
  --brandTint: #2D001F;
}
```

---

## ✍️ Firma de Responsabilidad Técnica

**David Martínez**  
*Escritor y Arquitecto Principal del Sistema*  
Correo Institucional: `dmartineza02@liverpool.com.mx`  
El Puerto de Liverpool · Equipo Ventel  
*Agosto de 2026*
