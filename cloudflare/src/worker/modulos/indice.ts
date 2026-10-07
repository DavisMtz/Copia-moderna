/**
 * Registro de TODAS las funciones que el navegador puede llamar (el equivalente a «las funciones
 * globales sin _ del proyecto de Apps Script»). Cada grupo exporta las suyas en `funciones`.
 * Lo que no está aquí no se puede llamar desde fuera.
 */
import type { FuncionRpc } from '../rpc';
import { funciones as identidad } from './identidad';
import { funciones as cotizaciones } from './cotizaciones';
import { funciones as revision } from './revision';
import { funciones as portal } from './portal';
import { funciones as operacion } from './operacion';
import { funciones as consola } from './consola';
import { funciones as nuevas } from './nuevas';

/**
 * La misma función vacía con la que el doc 15 midió Apps Script (labNoop, §3.2): no toca la base ni
 * devuelve datos. Sirve para comparar llamada contra llamada (pruebas/medir.mjs).
 */
const laboratorio: Record<string, FuncionRpc> = { labNoop: () => 'ok' };

export const REGISTRO: Record<string, FuncionRpc> = Object.assign(
  Object.create(null),
  identidad, cotizaciones, revision, portal, operacion, consola, nuevas, laboratorio
);
