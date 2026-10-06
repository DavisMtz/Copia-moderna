/*
 * =================================================================================================
 * Panel de velocidad · el arranque | Portal Ventel en Cloudflare
 * =================================================================================================
 * Lo único que baja cada una de las 20 pantallas (/vx/app/panel.js, lo inyecta scripts/construir.mjs
 * al final del <body>). Pinta un botón pequeño («⚡ 38 ms») dentro de un Shadow DOM —no hereda ni
 * rompe los estilos de la pantalla— y escucha las llamadas que apunta el puente (evento `vx:rpc`).
 *
 * Hasta que alguien lo abre NO hace ninguna petición: ni a /api/salud ni para bajar React. Al
 * abrirlo, import('./abierto') trae React y el panel en un trozo aparte (assets/abierto-*.js).
 *
 * Sin dependencias a propósito: cualquier import compartido con el explorador de datos acabaría en un
 * trozo común y sería una petición más en cada pantalla.
 * =================================================================================================
 */
import estilos from './boton.css?inline';

type Control = { cerrar(): void; enfocar(): void };
type Montar = (opciones: {
  raiz: ShadowRoot; montaje: HTMLElement; boton: HTMLButtonElement; host: HTMLElement;
  alCerrar(): void; volverAlBoton: boolean;
}) => Control;

const ETIQUETA = 'vx-velocidad';
const CLAVE_ABIERTO = 'vx-velocidad-abierto';
/** Botones flotantes de la esquina inferior derecha con los que no hay que chocar. */
const OBSTACULOS = '.cmdk-flota, .clip-fab';
const ALTO_BOTON = 28;
const MARGEN = 16;

function arrancar(): void {
  if (document.querySelector(ETIQUETA) || !document.body || !('attachShadow' in Element.prototype)) return;

  const host = document.createElement(ETIQUETA);
  host.setAttribute('data-vx-isla', 'velocidad');
  const raiz = host.attachShadow({ mode: 'open' });
  const hoja = document.createElement('style');
  hoja.textContent = estilos;
  raiz.appendChild(hoja);

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'vx-boton';
  boton.setAttribute('aria-expanded', 'false');
  boton.setAttribute('aria-controls', 'vx-panel');
  boton.innerHTML =
    '<svg class="vx-rayo" viewBox="0 0 16 16" aria-hidden="true"><path d="M9.2 1.2 3.4 9h4l-.9 5.8L12.6 7H8.5z"/></svg>' +
    '<span class="vx-cifra">Velocidad</span>';
  const cifra = boton.querySelector('.vx-cifra') as HTMLElement;
  const rayo = boton.querySelector('.vx-rayo') as SVGElement;
  const montaje = document.createElement('div');
  montaje.className = 'vx-montaje';
  raiz.append(boton, montaje);
  document.body.appendChild(host);

  /* ── Tema: el de la pantalla (data-theme / data-contrast en <html>, ViewPrefsPartial) ── */
  const de = document.documentElement;
  const reflejarTema = () => {
    host.setAttribute('data-tema', de.getAttribute('data-theme') || 'aurora');
    if (de.getAttribute('data-contrast') === 'high') host.setAttribute('data-contraste', '');
    else host.removeAttribute('data-contraste');
  };
  reflejarTema();
  new MutationObserver(reflejarTema).observe(de, { attributes: true, attributeFilter: ['data-theme', 'data-contrast'] });

  /* ── La cifra del botón: lo que tardó la última llamada al servidor ── */
  const formato = (ms: number) => (ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s');
  const pintarCifra = (m: MedidaRed | null) => {
    cifra.textContent = m ? formato(m.ms) : 'Velocidad';
    boton.classList.toggle('vx-fallo', !!m && !m.ok);
    boton.setAttribute('aria-label', m
      ? 'Velocidad: la última llamada al servidor tardó ' + formato(m.ms) + (m.ok ? '' : ' y falló') + '. Abre el panel.'
      : 'Velocidad de esta pantalla. Abre el panel.');
  };
  try {
    const previas = window.__vxRed ? window.__vxRed.medidas() : [];
    pintarCifra(previas.length ? previas[previas.length - 1] : null);
  } catch { pintarCifra(null); }
  window.addEventListener('vx:rpc', (e) => {
    pintarCifra(e.detail);
    const g = window.gsap;
    if (g && !movimientoReducido()) {
      g.fromTo(rayo, { scale: 1.45, rotate: -12 }, { scale: 1, rotate: 0, duration: 0.5, ease: 'back.out(3)', overwrite: 'auto', transformOrigin: '50% 50%' });
    }
  });

  /* ── Dónde se sienta: abajo a la derecha, a la izquierda de los botones flotantes que haya ── */
  let colocarPendiente = false;
  const colocar = () => {
    colocarPendiente = false;
    const vw = de.clientWidth;
    const vh = window.innerHeight;
    let derecha = MARGEN;
    let abajo: number | null = null;
    document.querySelectorAll<HTMLElement>(OBSTACULOS).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return;
      if (vw - r.right > 160 || vh - r.bottom > 220) return; // no está en la esquina
      derecha = Math.max(derecha, Math.round(vw - r.left + 10));
      abajo = Math.max(abajo ?? 0, Math.round(vh - r.bottom + (r.height - ALTO_BOTON) / 2));
    });
    host.style.setProperty('--vx-der', derecha + 'px');
    if (abajo === null) host.style.removeProperty('--vx-abajo');
    else host.style.setProperty('--vx-abajo', abajo + 'px');
    // El panel abierto se apoya justo encima del botón.
    const caja = boton.getBoundingClientRect();
    host.style.setProperty('--vx-panel-abajo', Math.round(vh - caja.top + 8) + 'px');
    host.style.setProperty('--vx-panel-der', Math.max(8, Math.round(vw - caja.right)) + 'px');
    host.setAttribute('data-listo', '');
  };
  const pedirColocar = () => {
    if (colocarPendiente) return;
    colocarPendiente = true;
    requestAnimationFrame(colocar);
  };
  // Primera vez después del primer pintado (no fuerza maquetación mientras la pantalla se arma).
  requestAnimationFrame(pedirColocar);
  window.addEventListener('resize', pedirColocar, { passive: true });
  window.addEventListener('load', () => { pedirColocar(); setTimeout(pedirColocar, 1500); setTimeout(pedirColocar, 4000); });
  // Los botones flotantes los crean las pantallas a su hora: se mira cuando cambia el <body>.
  new MutationObserver(pedirColocar).observe(document.body, { childList: true });
  new MutationObserver(pedirColocar).observe(de, { attributes: true, attributeFilter: ['data-textscale', 'class', 'style'] });

  /* ── Abrir y cerrar ── */
  let control: Control | null = null;
  let cargando: Promise<Montar> | null = null;
  let abierto = false;

  const recordar = (si: boolean) => {
    try { if (si) sessionStorage.setItem(CLAVE_ABIERTO, '1'); else sessionStorage.removeItem(CLAVE_ABIERTO); } catch { /* sin almacenamiento */ }
  };

  const abrir = (volverAlBoton: boolean) => {
    if (abierto) return;
    abierto = true;
    recordar(true);
    boton.setAttribute('aria-expanded', 'true');
    colocar();
    const espera = setTimeout(() => boton.classList.add('vx-cargando'), 180);
    cargando = cargando || import('./abierto').then((m) => m.montar);
    cargando.then((montar) => {
      clearTimeout(espera);
      boton.classList.remove('vx-cargando');
      if (!abierto) return;
      control = montar({ raiz, montaje, boton, host, volverAlBoton, alCerrar: cerrado });
    }, () => {
      // Sin red para bajar el panel: el botón vuelve a su estado y se puede reintentar.
      clearTimeout(espera);
      boton.classList.remove('vx-cargando');
      cargando = null;
      cerrado();
    });
  };

  /** Lo llama el panel cuando terminó de cerrarse (con o sin animación). */
  const cerrado = () => {
    abierto = false;
    control = null;
    recordar(false);
    boton.setAttribute('aria-expanded', 'false');
  };

  boton.addEventListener('click', () => {
    if (abierto) { if (control) control.cerrar(); else cerrado(); }
    else abrir(true);
  });
  // Escape cierra si el foco está en la isla (el de la pantalla es de la pantalla).
  raiz.addEventListener('keydown', (e) => {
    const k = e as KeyboardEvent;
    if (k.key === 'Escape' && abierto && control) {
      k.stopPropagation();
      control.cerrar();
      boton.focus();
    }
  });

  // Quien lo dejó abierto lo encuentra abierto en la siguiente pantalla, pero sin competir con ella:
  // se abre cuando la página ya cargó y el navegador está libre.
  let recordado = false;
  try { recordado = sessionStorage.getItem(CLAVE_ABIERTO) === '1'; } catch { recordado = false; }
  if (recordado) {
    const despues = () => setTimeout(() => {
      const ric = window.requestIdleCallback;
      if (ric) ric(() => abrir(false), { timeout: 2000 }); else abrir(false);
    }, 600);
    if (document.readyState === 'complete') despues(); else window.addEventListener('load', despues, { once: true });
  }
}

function movimientoReducido(): boolean {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

arrancar();
