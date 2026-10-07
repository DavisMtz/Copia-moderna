/*
 * Contraseña de las cuentas de la demo EN PRODUCCIÓN.
 *   node scripts/claves-produccion.mjs            → genera una contraseña nueva al azar
 *   node scripts/claves-produccion.mjs <clave>    → usa esa
 * Escribe semilla/99_claves_produccion.local.sql (NO va a git: el repo es público) con una sal de
 * contraseñas nueva y secreta (propiedad HASH_SALT: la de respaldo está en el código público) y el hash
 * de esa contraseña para todas las cuentas @ventel.example, e imprime la contraseña UNA vez.
 * scripts/desplegar.sh --semillas aplica ese archivo al final, después de los datos de demo. En local
 * sigue valiendo VentelDemo2026 con la sal de respaldo (semilla/00_usuarios_demo.sql).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Sal propia de producción: con ella, el hash de la base no se puede atacar con la sal pública del código.
const SAL = crypto.randomBytes(18).toString('base64');
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const azar = (n) => [...crypto.randomBytes(n)].map((b) => ABC[b % ABC.length]).join('');
const clave = process.argv[2] || ('Ventel-' + azar(5) + '-' + azar(5) + '-' + azar(4));
const hash = crypto.createHash('sha256').update(clave + SAL).digest('hex');
const destino = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'semilla', '99_claves_produccion.local.sql');
fs.writeFileSync(destino,
  '-- Contraseña de producción de las cuentas de la demo (solo el hash) y su sal. Generado por scripts/claves-produccion.mjs.\n' +
  "INSERT INTO propiedades (clave, valor, actualizado) VALUES ('HASH_SALT', '" + SAL + "', '" + new Date().toISOString() + "') " +
  'ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado = excluded.actualizado;\n' +
  "UPDATE registros SET password_hash = '" + hash + "', password_temporal = 0 WHERE email LIKE '%@ventel.example';\n");
console.log(clave);
