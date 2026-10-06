/** Lo que las islas leen de la página: el puente (src/shim/gas-shim.js) y GSAP del CDN. */

/** Una llamada al servidor vista desde el navegador (la apunta el puente). */
interface MedidaRed {
  /** Función (o «lote(a,b,c)» si viajaron juntas por secEjecutarLote). */
  fn: string;
  /** Ida y vuelta, en ms. */
  ms: number;
  /** Lo que trabajó el servidor según Server-Timing (app;dur), o -1 si no lo dijo. */
  srv: number;
  /** Cuándo llegó la respuesta (Date.now()). */
  t: number;
  ok: boolean;
}

interface Window {
  __vxRed?: { medidas(): MedidaRed[] };
  /** GSAP 3.13 por <script> desde cdnjs (no siempre está: la isla se ve igual sin él). */
  gsap?: any;
  requestIdleCallback?: (cb: () => void, opciones?: { timeout: number }) => number;
}

interface WindowEventMap {
  'vx:rpc': CustomEvent<MedidaRed>;
}
