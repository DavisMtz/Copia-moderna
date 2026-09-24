/*
 * Arma las carpetas de los dos laboratorios (fuera del repo, en el scratchpad):
 *   lab-mini   → solo el laboratorio (costo base de la plataforma)
 *   lab-grande → copia del Portal SIN secretos + laboratorio + la pantalla Portal pre-ensamblada
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const SCR = path.join(__dirname, '..');
const PROY = 'C:/Users/seguimientos/Desktop/Proyectos/Portal Ventel/Carpeta del proyecto';
const COMUN = path.join(SCR, 'lab-comun');
const MANIFIESTO = {
  timeZone: 'America/Mexico_City', runtimeVersion: 'V8', exceptionLogging: 'STACKDRIVER',
  oauthScopes: [],
  webapp: { executeAs: 'USER_DEPLOYING', access: 'MYSELF' }
};

function preparar(nombre, conPortal) {
  const dir = path.join(SCR, nombre);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/\.(gs|html|json)$/.test(f) && f !== '.clasp.json') fs.unlinkSync(path.join(dir, f));
  for (const f of fs.readdirSync(COMUN)) fs.copyFileSync(path.join(COMUN, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'appsscript.json'), JSON.stringify(MANIFIESTO, null, 2));
  if (!conPortal) return;

  for (const f of fs.readdirSync(PROY)) {
    if (!/\.(gs|html)$/.test(f)) continue;
    let s = fs.readFileSync(path.join(PROY, f), 'utf8');
    if (f.endsWith('.gs')) s = s.replace(/https:\/\/chat\.googleapis\.com\/v1\/spaces\/[^'"\s]+/g, 'https://chat.googleapis.com/v1/spaces/LAB');
    if (f === 'Code.gs') {
      s = s.replace(/^function doGet\(e\)/m, 'function doGet_portal_(e)');
      // Sin secretos en la copia: el laboratorio nunca los usa.
      s = s.replace(/^(const|var)\s+(HASH_SALT|WEBHOOK_URL)\s*=\s*"[^"]*"/gm, '$1 $2 = "LAB-SIN-SECRETO"');
      if (/^function doGet\(/m.test(s)) throw new Error('doGet sigue en Code.gs');
    }
    fs.writeFileSync(path.join(dir, f), s, 'utf8');
  }

  // La pantalla Portal ensamblada de antemano: una SIN comprimir y otra compilada.
  const { comoGoogle, completo } = require('./medir2-lib.js');
  const RE = /<\?!=\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*\?>/g;
  const leer = (n) => fs.readFileSync(path.join(PROY, n.endsWith('.html') ? n : n + '.html'), 'utf8');
  const index = leer('Index.html').replace(/<!--[\s\S]*?-->/g, '');
  const inline = index.replace(RE, (m, n) => leer(n));
  const min = completo(index.replace(RE, (m, n) => '\u0000' + n + '\u0000')).replace(/\u0000([^\u0000]+)\u0000/g, (m, n) => completo(leer(n)));
  fs.writeFileSync(path.join(dir, 'lab_portal_inline.html'), inline, 'utf8');
  fs.writeFileSync(path.join(dir, 'lab_portal_min.html'), min, 'utf8');
  console.log(nombre + ': inline ' + Math.round(inline.length / 1024) + ' KB · min ' + Math.round(min.length / 1024) + ' KB');
}

preparar('lab-mini', false);
preparar('lab-grande', true);
for (const n of ['lab-mini', 'lab-grande']) {
  const fs2 = fs.readdirSync(path.join(SCR, n));
  console.log(n + ': ' + fs2.length + ' archivos, secretos presentes: ' +
    fs2.filter((f) => f.endsWith('.gs')).some((f) => /chat\.googleapis|vPe\/O5s2/.test(fs.readFileSync(path.join(SCR, n, f), 'utf8'))));
}
