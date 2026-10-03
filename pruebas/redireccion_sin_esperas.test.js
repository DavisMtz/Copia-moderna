/*
 * Opción A de la investigación del 03/10/2026: navegar EN CUANTO el servidor confirma.
 *   node pruebas/redireccion_sin_esperas.test.js
 *
 * Una webapp de Apps Script solo puede cambiar de pantalla unos 5 s después del clic (el iframe
 * de Google trae allow-top-navigation-by-user-activation). El servidor ya se come casi todo ese
 * tiempo, así que cualquier espera ANTES de AppUrl.go —900 ms para lucir la palomita del login,
 * 1400 ms para «¡Cuenta creada!»— basta para que la navegación llegue tarde y salga el aviso de
 * «toca aquí para seguir». Esto vigila que no vuelvan, que la confirmación del registro y de la
 * recuperación siga llegando al login (ventel-aviso-login) y que abrir sesión no barra el
 * almacén de sesiones (eso lo cubre en detalle la sección 8 de sesiones.test.js).
 * Esta carpeta queda fuera de "Carpeta del proyecto": clasp nunca la sube.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const PROY = path.join(__dirname, '..', 'Carpeta del proyecto');
const leer = (f) => fs.readFileSync(path.join(PROY, f), 'utf8').replace(/\r\n/g, '\n');
const login = leer('inicioDeSesion.html');
const registro = leer('registro.html');
const recuperar = leer('recuperar.html');
const sesiones = leer('Sesiones.gs');

let total = 0, fallos = 0;
function ok(nombre, cond, extra) {
  total++;
  if (cond) { console.log('  ✔ ' + nombre); return; }
  fallos++;
  console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}
/* Desde `desde` hasta la llave que cierra el primer bloque que se abre después (salta cadenas y comentarios). */
function bloque(texto, desde) {
  const i = texto.indexOf(desde);
  if (i < 0) return '';
  let d = 0, q = null;
  for (let j = texto.indexOf('{', i); j > -1 && j < texto.length; j++) {
    const c = texto[j], s = texto[j + 1];
    if (q) { if (c === '\\') { j++; continue; } if (c === q) q = null; continue; }
    if (c === '/' && s === '/') { j = texto.indexOf('\n', j); continue; }
    if (c === '/' && s === '*') { j = texto.indexOf('*/', j + 2) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') d++;
    if (c === '}' && --d === 0) return texto.slice(i, j + 1);
  }
  return '';
}
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('\nA · El login navega en cuanto el servidor confirma');
{
  const exito = sinComentarios(bloque(login, 'const showSuccessStateAndRedirect = () =>'));
  ok('showSuccessStateAndRedirect existe', exito.length > 0);
  ok('…y no espera a nada antes de navegar (sin setTimeout)', exito.length > 0 && !/setTimeout\s*\(/.test(exito), exito.slice(0, 400));
  ok('…llama a goNextOrHome directamente', /if \(!AppUrl\.goNextOrHome\(\)\) \{/.test(exito));
  const pasoDos = sinComentarios(bloque(login, "setPasswordForm.addEventListener('submit'"));
  ok('«Guardar y entrar» (contraseña temporal) no espera al cambio de tarjeta para navegar',
    /AppMotion\.swap\(setPasswordContainer, loadingContainer\);\s*showSuccessStateAndRedirect\(\);/.test(pasoDos), pasoDos.slice(0, 200));
}

console.log('\nB · Registro y recuperación: sin la espera de 1400 ms, y la confirmación viaja al login');
for (const [nombre, texto, aviso] of [['registro', registro, 'Tu cuenta quedó creada'], ['recuperar', recuperar, 'Tu contraseña quedó actualizada']]) {
  const sinC = sinComentarios(texto);
  const iGo = sinC.indexOf("if (!AppUrl.go('login')) {\n                        ocultarCarga();");
  ok(nombre + ': navega al login al confirmar', iGo > -1);
  const antes = sinC.slice(Math.max(0, iGo - 700), iGo);
  ok(nombre + ': sin setTimeout envolviendo esa navegación', iGo > -1 && !/setTimeout\s*\(\s*\(\)\s*=>\s*\{\s*$/.test(antes.trimEnd()) &&
    !/setTimeout\s*\(\s*\(\)\s*=>\s*\{[^}]*AppUrl\.go\('login'\)/.test(sinC));
  ok(nombre + ': deja la confirmación para el login ANTES de navegar',
    antes.indexOf("sessionStorage.setItem('ventel-aviso-login'") > -1 && antes.indexOf(aviso) > -1);
}

console.log('\nC · El login enseña la confirmación una vez (código real, sessionStorage de mentira)');
{
  const ini = login.indexOf('// La confirmación que dejaron el registro');
  const fin = login.indexOf("AuthStage.play({ title: '[data-split]' });", ini);
  const trozo = ini > -1 && fin > ini ? login.slice(ini, fin) : '';
  ok('se encuentra el trozo que lee el aviso', /ventel-aviso-login/.test(trozo));
  function correr(guardado, ahora) {
    const almacen = new Map(guardado === undefined ? [] : [['ventel-aviso-login', guardado]]);
    const mensajes = [];
    const ctx = {
      JSON, String, Number,
      Date: { now: () => ahora },
      sessionStorage: { getItem: (k) => (almacen.has(k) ? almacen.get(k) : null), removeItem: (k) => almacen.delete(k) },
      showMessage: (texto, error) => mensajes.push([texto, error])
    };
    vm.createContext(ctx);
    vm.runInContext(trozo, ctx);
    return { mensajes, queda: almacen.has('ventel-aviso-login') };
  }
  const t = 1759500000000;
  let r = correr(JSON.stringify({ texto: 'Tu cuenta quedó creada. Entra con tu contraseña.', at: t - 3000 }), t);
  ok('aviso reciente → se enseña como confirmación (no como error)',
    r.mensajes.length === 1 && r.mensajes[0][0] === 'Tu cuenta quedó creada. Entra con tu contraseña.' && r.mensajes[0][1] === false, r);
  ok('…y se tira: un F5 no lo repite', r.queda === false);
  r = correr(JSON.stringify({ texto: 'viejo', at: t - 11 * 60000 }), t);
  ok('aviso de hace más de 10 min → no se enseña, pero se tira', r.mensajes.length === 0 && r.queda === false, r);
  r = correr('{roto', t);
  ok('aviso ilegible → ni revienta ni se enseña', r.mensajes.length === 0);
  r = correr(undefined, t);
  ok('sin aviso → nada', r.mensajes.length === 0);
}

console.log('\nD · Abrir sesión ya no barre el almacén');
{
  const crear = sinComentarios(bloque(sesiones, 'function sesCrear_('));
  ok('sesCrear_ no llama a sesPurgar_', crear.length > 0 && !/sesPurgar_\(/.test(crear), crear);
  const lote = sinComentarios(bloque(sesiones, 'function secEjecutarLote('));
  ok('secEjecutarLote sí (después de calcular las respuestas)', /const respuestas = lote\.map[\s\S]*sesPurgar_\(Date\.now\(\)\);\s*return respuestas;/.test(lote));
}

console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
process.exit(fallos ? 1 : 0);
