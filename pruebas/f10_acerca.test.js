/*
 * Pruebas de la pantalla «Acerca de» (fase 10).   Ejecutar:  node pruebas/f10_acerca.test.js
 *
 * F10 no estrena ni una función de servidor: la pantalla se pinta con el catálogo que ya
 * viaja en el HTML y con la sesión que ya está en el navegador. Eso cambia qué hay que
 * probar. Aquí no hay hojas de cálculo fingidas —no hacen falta— y sí tres cosas que, si
 * se rompen, se rompen en silencio y nadie se entera hasta que alguien abre la pantalla:
 *
 *   1. EL CRITERIO 1 DE LA FASE: «un asesor y un maestro ven listas de funciones
 *      distintas, cada una completa para su sesión». Se comprueba con el filtro REAL
 *      —AppIndices.funciones('acerca', ctx), cargado del partial de verdad— contra cuatro
 *      sesiones: visitante, asesor, supervisión y maestro. No basta con que las listas
 *      difieran: se comprueba además que cada una NO trae lo que esa persona no puede
 *      abrir, que es el fallo que importa.
 *
 *   2. LOS ESPEJOS DEL ALTA. Una pantalla nueva vive en cinco listas repartidas por tres
 *      archivos (PAGES, AppUrl.PAGINAS, PAGINAS_TRAS_LOGIN, el pie de la barra y el pie
 *      del Portal). Olvidar una no da error: da una pantalla que no escribe su URL, o un
 *      login que devuelve al panel en vez de a donde te habían mandado.
 *
 *   3. QUE NINGUNA FUNCIÓN SE QUEDE MUDA. El instructivo vive en app_instructivos, keado
 *      por el `id` del catálogo. Si alguien da de alta una función el año que viene y no
 *      pasa por aquí, su tarjeta saldría con el subtítulo del buscador. Se comprueba que
 *      las claves cubran el catálogo entero.
 *
 * Los partials del cliente se cargan y se EJECUTAN de verdad (misma técnica que
 * f6_buscador_paridad): así la prueba mide el archivo que hay hoy y no una copia suya.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const PROY = path.join(__dirname, '..', 'Carpeta del proyecto');

let pruebas = 0, fallos = 0;
function ok(nombre, cond, extra) {
  pruebas++;
  if (cond) { console.log(`  ✔ ${nombre}`); return; }
  fallos++;
  console.log(`  ✘ ${nombre}${extra ? '  → ' + extra : ''}`);
}
function eq(nombre, real, esperado) {
  ok(nombre, real === esperado, `esperaba ${JSON.stringify(esperado)}, llegó ${JSON.stringify(real)}`);
}

const leer = (f) => fs.readFileSync(path.join(PROY, f), 'utf8');

/* ── Cargar un partial de cliente y quedarse con lo que publica en window ──────
   Los partials son <script> dentro de un .html. Se extrae el bloque, se corre en un
   contexto donde `window` es el propio contexto —como en el navegador— y se devuelve lo
   que haya colgado. Si un partial deja de publicar su objeto, esto revienta aquí y no en
   la pantalla. */
function cargaPartial(archivo, publica) {
  const bloques = leer(archivo).match(/<script>([\s\S]*?)<\/script>/g) || [];
  const ctx = { console: { log() {}, warn() {}, error() {} }, Math, JSON, String, Number,
                Object, Array, RegExp, Date, setTimeout: () => 0 };
  ctx.window = ctx;
  vm.createContext(ctx);
  bloques.forEach((b) => {
    const js = b.replace(/^<script>/, '').replace(/<\/script>$/, '');
    if (js.indexOf('<?') !== -1) return;     // plantilla del servidor, no es JS todavía
    vm.runInContext(js, ctx, { filename: archivo });
  });
  if (!ctx[publica]) throw new Error(`${archivo} no publicó window.${publica}`);
  return ctx[publica];
}

const IDX = cargaPartial('app_indices.html', 'AppIndices');
const INS = cargaPartial('app_instructivos.html', 'AppInstructivos');
const CRE = cargaPartial('app_creditos.html', 'AppCreditos');

const CODE   = leer('Code.gs');
const CORE   = leer('app_core.html');
const SHELL  = leer('app_shell.html');
const INDEX  = leer('Index.html');
const ACERCA = leer('acerca.html');

/* Las cuatro sesiones con las que se mide todo. Los bloques son los reales de
   Permisos.gs; lo que importa de cada una es qué NO tiene. */
const VISITANTE  = { conSesion: false, esMaestro: false, puede: () => false };
const ASESOR     = { conSesion: true,  esMaestro: false,
                     puede: (b) => ['cotizar', 'enviar_cotizacion', 'correos_cliente', 'atenciones'].indexOf(b) !== -1 };
const SUPERVISOR = { conSesion: true,  esMaestro: false,
                     puede: (b) => ['cotizar', 'enviar_cotizacion', 'correos_cliente', 'atenciones',
                                    'supervision', 'revisar', 'politica_revision', 'sup_equipo',
                                    'metricas', 'operacion'].indexOf(b) !== -1 };
const MAESTRO    = { conSesion: true,  esMaestro: true,  puede: () => true };

const ids = (ctx) => IDX.funciones('acerca', ctx).map((f) => f.id);

/* ═══════════════════════════════════════════════════════════════════════════
   1 · CRITERIO 1 DE LA FASE — cada quien ve SU lista, y completa
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n1 · Qué puedes hacer tú — la lista sale de la sesión');
{
  const deAsesor  = ids(ASESOR);
  const deMaestro = ids(MAESTRO);
  const deSuper   = ids(SUPERVISOR);

  ok('un asesor y un maestro ven listas DISTINTAS (criterio 1)',
     deAsesor.join(',') !== deMaestro.join(','));
  ok('la del maestro es más larga que la del asesor',
     deMaestro.length > deAsesor.length, `maestro ${deMaestro.length}, asesor ${deAsesor.length}`);
  ok('la de una supervisión queda entre las dos',
     deSuper.length > deAsesor.length && deSuper.length < deMaestro.length,
     `asesor ${deAsesor.length}, supervisión ${deSuper.length}, maestro ${deMaestro.length}`);

  // Completa: el asesor ve TODO lo suyo…
  ['dashboard', 'cotizacion', 'correoventel', 'correo_cliente', 'atenciones',
   'portal', 'estado', 'articulos'].forEach((id) => {
    ok(`el asesor ve «${id}»`, deAsesor.indexOf(id) !== -1);
  });
  // …y NADA de lo que no es suyo, que es la mitad que de verdad importa.
  ['consola', 'inicio_avanzado', 'revisar', 'politica', 'anuncios', 'portal_contenido',
   'operacion', 'equipo', 'monitoreo', 'feed-supervision'].forEach((id) => {
    ok(`el asesor NO ve «${id}»`, deAsesor.indexOf(id) === -1);
  });

  // La supervisión ve lo suyo y sigue sin ver la consola (que es de maestro).
  ['inicio_avanzado', 'revisar', 'politica', 'equipo', 'monitoreo', 'operacion',
   'feed-supervision'].forEach((id) => {
    ok(`la supervisión ve «${id}»`, deSuper.indexOf(id) !== -1);
  });
  ok('la supervisión NO ve la Consola (lleva `maestro`)', deSuper.indexOf('consola') === -1);
  ok('el maestro SÍ ve la Consola', deMaestro.indexOf('consola') !== -1);

  /* Un asesor con un bloque APAGADO por mantenimiento deja de ver esa función: el
     servidor resta los apagados de la lista de bloques, así que basta con hacerle caso.
     Se comprueba porque es el caso en el que una lista «completa» miente. */
  const sinCotizar = { conSesion: true, esMaestro: false,
                       puede: (b) => ['enviar_cotizacion', 'atenciones'].indexOf(b) !== -1 };
  ok('sin el bloque `cotizar`, «Nueva cotización» desaparece de la lista',
     ids(sinCotizar).indexOf('cotizacion') === -1);
}

/* ═══════════════════════════════════════════════════════════════════════════
   2 · LA SUPERFICIE 'acerca' — por qué no es funciones('portal', …)
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n2 · La superficie «acerca» pide la lista completa');
{
  const enAcerca = ids(MAESTRO);
  const enPortal = IDX.funciones('portal', MAESTRO).map((f) => f.id);
  const enCmdk   = IDX.funciones('cmdk', MAESTRO).map((f) => f.id);

  /* Las dos que motivaron la superficie propia: llevan `fuera:['portal']` porque en el
     Portal se está parado encima de ellas, y son justo dos de las cosas que alguien
     nuevo tiene que enterarse de que puede abrir. */
  ok('«Acerca de» ofrece «Portal Ventel» (el buscador del Portal no)',
     enAcerca.indexOf('portal') !== -1 && enPortal.indexOf('portal') === -1);
  ok('«Acerca de» ofrece «Monitor de promociones» (el buscador del Portal no)',
     enAcerca.indexOf('promociones') !== -1 && enPortal.indexOf('promociones') === -1);
  ok('«Acerca de» ofrece «Atenciones rescatables» (el buscador general no)',
     enAcerca.indexOf('atenciones-rescatables') !== -1 &&
     enCmdk.indexOf('atenciones-rescatables') === -1);

  ok('«Acerca de» NO se ofrece a sí misma (`fuera:[\'acerca\']`)',
     enAcerca.indexOf('acerca') === -1);
  ok('…pero SÍ la ofrecen los dos buscadores',
     enPortal.indexOf('acerca') !== -1 && enCmdk.indexOf('acerca') !== -1);

  /* Sin sesión la pantalla ni siquiera se pinta (requireSession), pero el filtro tiene
     que comportarse igual que las otras superficies: nada que exija identidad. */
  const deVisitante = IDX.funciones('acerca', VISITANTE);
  ok('un visitante no recibe nada marcado `sesion` desde esta superficie',
     !deVisitante.some((f) => f.sesion));
}

/* ═══════════════════════════════════════════════════════════════════════════
   3 · LA ENTRADA DEL CATÁLOGO
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n3 · «Acerca del Portal» en el catálogo compartido');
{
  const ent = IDX.catalogo.filter((f) => f.id === 'acerca')[0];
  ok('existe la entrada `acerca` en el catálogo', !!ent);
  if (ent) {
    eq('apunta a la pantalla `acerca`', ent.page, 'acerca');
    ok('NO lleva bloques (es informativa, T10.1)', !ent.bloques);
    ok('NO lleva `maestro`', !ent.maestro);
    ok('NO se marca `publica`: sin sesión no tiene mitad que enseñar', !ent.publica);
    ok('lleva `fuera:[\'acerca\']`', Array.isArray(ent.fuera) && ent.fuera.indexOf('acerca') !== -1);
    ok('sus palabras clave incluyen «creditos» y «extension»',
       /creditos/.test(ent.kw) && /extension/.test(ent.kw));
  }

  /* El icono tiene que saber pintarlo TODO el que pinte el catálogo. Son tres mapas en
     tres archivos y el fallo es mudo: sale un marco vacío o una llave inglesa. */
  const iconos = new Set(IDX.catalogo.map((f) => f.icono));
  const enCmdk = leer('app_comando.html').match(/var ICONO_DE_CATALOGO = \{[\s\S]*?\n  \};/)[0];
  const enPortal = INDEX.match(/^const ICONS = \{[\s\S]*?\n\};/m)[0];
  const enIconsJs = leer('app_icons.html');
  iconos.forEach((ic) => {
    ok(`el buscador general sabe pintar «${ic}»`, new RegExp('[{,\\s]' + ic + ':').test(enCmdk));
    ok(`el buscador del Portal sabe pintar «${ic}»`,
       new RegExp('^\\s{2}' + ic + ':', 'm').test(enPortal) || ic === 'globe');
    ok(`app_icons sabe pintar «${ic}» (lo usa la lista de «Acerca de»)`,
       new RegExp('^\\s{4}' + ic + ':', 'm').test(enIconsJs));
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 · NINGUNA FUNCIÓN SE QUEDA MUDA
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n4 · Instructivos: uno por cada función del catálogo');
{
  const delCatalogo = IDX.catalogo.map((f) => f.id);
  const sinTexto = delCatalogo.filter((id) => !INS.de(id));
  ok(`las ${delCatalogo.length} funciones del catálogo tienen instructivo`,
     sinTexto.length === 0, 'sin instructivo: ' + sinTexto.join(', '));

  const sobrantes = INS.claves().filter((k) => delCatalogo.indexOf(k) === -1);
  ok('no hay instructivos huérfanos (de funciones que ya no existen)',
     sobrantes.length === 0, 'sobran: ' + sobrantes.join(', '));

  /* Un instructivo dice CÓMO SE USA; el `sub` del catálogo dice qué es. Si son iguales,
     alguien copió y pegó y la pantalla no aporta nada sobre el buscador. */
  const calcados = IDX.catalogo.filter((f) => INS.de(f.id) && INS.de(f.id) === f.sub);
  ok('ningún instructivo es una copia del subtítulo del catálogo',
     calcados.length === 0, 'calcados: ' + calcados.map((f) => f.id).join(', '));

  eq('un id que no existe devuelve cadena vacía, no undefined', INS.de('no-existe'), '');
}

/* ═══════════════════════════════════════════════════════════════════════════
   5 · LOS ESPEJOS DEL ALTA DE PANTALLA
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n5 · La pantalla dada de alta en todas sus listas');
{
  ok('`acerca` está en PAGES (Code.gs)', /'acerca':\s*\{\s*file:\s*'acerca'/.test(CODE));
  ok('NO está en PORTAL_PAGES (exige sesión)',
     !/PORTAL_PAGES\s*=\s*\{[\s\S]*?'acerca'[\s\S]*?\n\};/.test(CODE));
  ok('existe el archivo acerca.html', fs.existsSync(path.join(PROY, 'acerca.html')));

  const paginas = CORE.match(/PAGINAS:\s*\[([\s\S]*?)\]/)[1];
  ok('`acerca` está en AppUrl.PAGINAS (sin esto la URL no se escribe)',
     /'acerca'/.test(paginas));
  const trasLogin = CORE.match(/PAGINAS_TRAS_LOGIN:\s*\[([\s\S]*?)\]/)[1];
  ok('`acerca` está en PAGINAS_TRAS_LOGIN (?next=acerca tras el login)',
     /'acerca'/.test(trasLogin));
  ok('`acerca` tiene nombre legible en NOMBRES_PAGINA', /'acerca':\s*'/.test(CORE));

  /* El espejo que de verdad importa: toda clave de PAGES y PORTAL_PAGES tiene que estar
     en AppUrl.PAGINAS, que es lo que el cliente usa para saber si una pantalla existe. */
  const delServidor = [];
  const bloque = CODE.match(/const PAGES = \{[\s\S]*?\n\};/)[0] +
                 CODE.match(/const PORTAL_PAGES = \{[\s\S]*?\n\};/)[0];
  let m; const re = /^\s*'([a-z_]+)':\s*\{\s*file:/gm;
  while ((m = re.exec(bloque)) !== null) delServidor.push(m[1]);
  const faltantes = delServidor.filter((p) => paginas.indexOf(`'${p}'`) === -1);
  ok(`las ${delServidor.length} pantallas del enrutador están en AppUrl.PAGINAS`,
     faltantes.length === 0, 'faltan: ' + faltantes.join(', '));
}

/* ═══════════════════════════════════════════════════════════════════════════
   6 · LAS DOS ENTRADAS DISCRETAS (T10.1)
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n6 · La entrada en el pie de la barra y en el Portal');
{
  /* La barra se construye por concatenación de cadenas, así que en el FUENTE las
     comillas del onclick van escapadas: AppShell.nav(\'acerca\'). Se busca esa forma. */
  ok('el pie de la barra de la app ofrece «Acerca del Portal»',
     /side-foot-link[\s\S]{0,500}AppShell\.nav\(\\'acerca\\'\)/.test(SHELL) &&
     /<span>Acerca del Portal<\/span>/.test(SHELL));
  ok('sideFootHTML recibe la pantalla activa (para marcarse)',
     /function sideFootHTML\(active\)/.test(SHELL) && /sideFootHTML\(active\)/.test(SHELL));
  ok('la marca activa lleva aria-current', /aria-current="page"/.test(SHELL));
  ok('app_shell trae el estilo de .side-foot-link (no reusa el del tutorial)',
     /\.side-foot-link\s*\{/.test(SHELL));

  ok('el pie del Portal ofrece «Acerca del Portal»',
     /side-foot-link[\s\S]{0,400}page=acerca/.test(INDEX));
  ok('el Portal trae su propia copia del estilo', /\.side-foot-link\{/.test(INDEX));

  ok('el conmutador de área trata `acerca` como Portal y no como Cotizaciones',
     /active === 'acerca'\) \? 'portal'/.test(SHELL.replace(/\s+/g, ' ')) ||
     /'articulo' \|\| active === 'acerca'/.test(SHELL.replace(/\s+/g, ' ')));
}

/* ═══════════════════════════════════════════════════════════════════════════
   7 · LA PANTALLA
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n7 · acerca.html');
{
  ok('exige sesión y NO un bloque (es informativa)',
     /requireSession\('acerca'\)/.test(ACERCA) && !/requireBlock\(/.test(ACERCA));
  ok('monta el shell declarándose `acerca`', /AppShell\.mount\(\{ active: 'acerca'/.test(ACERCA));
  ok('apaga el loader de arranque (si no, tapa la pantalla 12 s)',
     /VentelLoader\.hide\(\)/.test(ACERCA));
  ok('tiene #main-content (sin él, AppShell aborta)', /id="main-content"/.test(ACERCA));
  ok('declara el viewport (la rama de app no lo inyecta)',
     /name="viewport"/.test(ACERCA));
  ok('declara el idioma', /<html lang="es"/.test(ACERCA));
  ok('recibe el estado inicial por APP_JSON y no por APP_URL',
     /window\.__APP__ = <\?!= APP_JSON \?>/.test(ACERCA) && !/<\?=? ?APP_URL/.test(ACERCA));

  ok('pide la lista al catálogo con la superficie `acerca`',
     /AppIndices\.funciones\('acerca'/.test(ACERCA));
  ok('escapa todo lo que pinta (usa escapeHtml)', /var esc = window\.escapeHtml/.test(ACERCA));
  ok('no compone URLs a mano', !/'\?page=/.test(ACERCA.replace(/<\?=[\s\S]*?\?>/g, '')));

  /* Criterio 2: contenido estático + sesión local. La pantalla no puede llamar al
     servidor para pintarse. La única llamada permitida es refrescar los bloques cuando
     la sesión no los conoce, que es lo que hace correcta la lista. */
  const llamadas = (ACERCA.match(/AppRun\.(call|swr)\(/g) || []);
  ok('la pantalla no llama al servidor por su cuenta (criterio 2)',
     llamadas.length === 0, llamadas.join(', '));
  ok('la única excepción declarada es refrescar los bloques desconocidos',
     /!AppSession\.bloquesConocidos[\s\S]{0,200}AppSession\.refrescar\(\)/.test(ACERCA));
  ok('no incluye app_operacion (pide el estado 900 ms después de cargar)',
     !/include\('app_operacion'\)/.test(ACERCA));
  ok('no incluye app_atenciones (trae su propia caché)',
     !/include\('app_atenciones'\)/.test(ACERCA));

  ok('enlaza la guía de la extensión con su gancho (data-xg-abrir)',
     /data-xg-abrir/.test(ACERCA) && /include\('app_extension_guia'\)/.test(ACERCA));
  ok('ofrece la línea de soporte (data-support-link)',
     /data-support-link/.test(ACERCA) && /include\('app_support'\)/.test(ACERCA));
  ok('T10.3 · enlaza los artículos y no duplica el mecanismo',
     /AppUrl\.(build|go)\('articulo'\)/.test(ACERCA) && !/artListar|artObtener/.test(ACERCA));

  ok('los créditos NO están escritos en el markup', !/David Martínez/.test(ACERCA));
  ok('los créditos vienen de app_creditos',
     /include\('app_creditos'\)/.test(ACERCA) && /AppCreditos\.personas\(\)/.test(ACERCA));
  ok('los instructivos vienen de app_instructivos',
     /include\('app_instructivos'\)/.test(ACERCA) && /AppInstructivos\.de\(/.test(ACERCA));

  /* Animación: la casa exige degradación sin CDN y respeto a prefers-reduced-motion. */
  ok('la entrada respeta prefers-reduced-motion',
     /prefers-reduced-motion: reduce/.test(ACERCA) && /function conGsap\(\)/.test(ACERCA));
  ok('la entrada degrada si GSAP no cargó', /!!window\.gsap/.test(ACERCA));
  ok('solo se anima opacidad y desplazamiento',
     !/gsap\.(from|to|fromTo)\([\s\S]{0,160}(width|height|left|top|margin)\s*:/.test(ACERCA));

  /* Ni un color a mano: los tres temas y el alto contraste dependen de ello. */
  const css = ACERCA.match(/<style>([\s\S]*?)<\/style>/)[1];
  const colores = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  ok('el CSS de la pantalla no escribe colores a mano (salvo el blanco del botón)',
     colores.filter((c) => c.toLowerCase() !== '#fff' && c.toLowerCase() !== '#ffffff').length === 0,
     colores.join(', '));
}

/* ═══════════════════════════════════════════════════════════════════════════
   8 · CRÉDITOS Y FICHA
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n8 · Créditos mantenibles fuera del markup');
{
  const p = CRE.personas();
  ok('hay al menos una persona acreditada', Array.isArray(p) && p.length >= 1);
  ok('cada persona trae nombre, papel y detalle',
     p.every((x) => x && x.nombre && x.papel && x.detalle));
  ok('personas() devuelve una copia (nadie puede vaciar la lista de todos)',
     (function () { const a = CRE.personas(); a.length = 0; return CRE.personas().length === p.length; })());

  const f = CRE.ficha();
  ok('la ficha trae versión, plataforma, organización y desde cuándo',
     !!(f.version && f.plataforma && f.organizacion && f.desde));
  ok('ficha() devuelve una copia',
     (function () { const a = CRE.ficha(); a.version = 'x'; return CRE.ficha().version === f.version; })());
}

/* ═══════════════════════════════════════════════════════════════════════════
   9 · LOS TOKENS QUE FALTABAN EN EL TEMA
   ═══════════════════════════════════════════════════════════════════════════
   articulo.html usa --s* y --fs-* cincuenta y nueve veces y app_theme no las definía:
   `padding: var(--s4) var(--s3) var(--s6)` con las variables sin declarar es una
   declaración inválida, así que el visor de artículos se pintaba sin un solo margen. Se
   subieron al tema en esta fase; esta comprobación es lo que evita que se caigan otra vez.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n9 · La escala de espacio y de texto vive en el tema');
{
  const tema = leer('app_theme.html');
  ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6',
   '--fs-xs', '--fs-sm', '--fs-md', '--fs-lg'].forEach((t) => {
    ok(`app_theme declara ${t}`, new RegExp(t.replace(/-/g, '\\-') + ':\\s*[^;]+;').test(tema));
  });
  ok('los tamaños de texto van en rem (para que --textscale los mueva)',
     /--fs-sm:\s*\.?\d+(\.\d+)?rem/.test(tema));

  // Y que nadie use un token de escala que no exista.
  const usados = new Set();
  ['acerca.html', 'articulo.html'].forEach((f) => {
    (leer(f).match(/var\(--(s\d|fs-[a-z0-9]+)\)/g) || []).forEach((u) => {
      usados.add(u.replace(/^var\(/, '').replace(/\)$/, ''));
    });
  });
  const huerfanos = [...usados].filter((t) => !new RegExp(t.replace(/-/g, '\\-') + ':').test(tema));
  ok(`los ${usados.size} tokens de escala que usan acerca y articulo existen en el tema`,
     huerfanos.length === 0, 'sin declarar: ' + huerfanos.join(', '));
}

console.log('\n─────────────────────────────────────────────');
console.log(fallos === 0 ? `TODO OK · ${pruebas} comprobaciones` : `${fallos} FALLOS de ${pruebas}`);
process.exit(fallos === 0 ? 0 : 1);
