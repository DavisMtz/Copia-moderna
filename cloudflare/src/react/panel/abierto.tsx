/*
 * =================================================================================================
 * Panel de velocidad · abierto (React 19) | Portal Ventel en Cloudflare
 * =================================================================================================
 * Llega en un trozo aparte cuando alguien abre el botón (ver main.ts) y se monta dentro del mismo
 * Shadow DOM. Enseña, medido en el navegador de quien lo abre:
 *   · contra Apps Script, con cifras medidas del repo y su fuente (fuentes.ts);
 *   · cada llamada que hizo ESTA pantalla al servidor (lo apunta el puente: __vxRed y `vx:rpc`), con
 *     su ida y vuelta y lo que trabajó el servidor (Server-Timing);
 *   · la carga de la página (Navigation Timing) y una línea de tiempo de los primeros segundos;
 *   · el punto de Cloudflare que atendió y lo que tarda D1 (GET /api/salud, solo al abrir).
 * Movimiento con window.gsap si está y no se pidió movimiento reducido; sin él se ve igual, quieto.
 * =================================================================================================
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import estilos from './panel.css?inline';
import { FUENTES, GAS, CIUDADES, type CifraGas } from './fuentes';
import { tiempo, bytes, numero, veces, mediana, fechaHora } from '../compartido/formato';

/* ── Las llamadas que apunta el puente ───────────────────────────────────────────────────────── */

let llamadas: MedidaRed[] = [];
try { llamadas = window.__vxRed ? window.__vxRed.medidas() : []; } catch { llamadas = []; }
const avisos = new Set<() => void>();
window.addEventListener('vx:rpc', (e) => {
  llamadas = llamadas.concat([e.detail]).slice(-200);
  avisos.forEach((f) => f());
});
const suscribir = (f: () => void) => { avisos.add(f); return () => { avisos.delete(f); }; };
const useLlamadas = () => useSyncExternalStore(suscribir, () => llamadas);

/** El instante en que empezó a cargarse ESTA pantalla, en ms desde 1970: para situar cada llamada. */
const ORIGEN = performance.timeOrigin || Date.now() - performance.now();
const finDe = (m: MedidaRed) => m.t - ORIGEN;
const inicioDe = (m: MedidaRed) => m.t - ORIGEN - m.ms;

function movimientoReducido(): boolean {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
const gsapListo = () => (window.gsap && !movimientoReducido() ? window.gsap : null);

/* ── Navigation Timing ───────────────────────────────────────────────────────────────────────── */

interface Carga {
  primerByte: number | null; htmlFin: number | null; lista: number | null; cargada: number | null;
  bytesHtml: number | null; precargada: boolean; tipo: string;
  archivos: number; deCache: number; bytesRed: number;
}

function leerCarga(): Carga {
  const n = performance.getEntriesByType('navigation')[0] as (PerformanceNavigationTiming & { deliveryType?: string }) | undefined;
  const propios = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter((r) =>
    r.name.indexOf(location.origin + '/') === 0 && r.initiatorType !== 'fetch' && r.initiatorType !== 'xmlhttprequest' &&
    r.name.indexOf('/vx/app/assets/') === -1);
  const enCache = propios.filter((r) => (r.transferSize === 0 && r.decodedBodySize > 0) || (r as any).deliveryType === 'cache');
  return {
    // Como en el doc 16 §4 («Medir una pantalla»): responseStart − requestStart.
    primerByte: n && n.responseStart > 0 ? Math.max(0, n.responseStart - n.requestStart) : null,
    htmlFin: n && n.responseEnd > 0 ? n.responseEnd : null,
    lista: n && n.domContentLoadedEventEnd > 0 ? n.domContentLoadedEventEnd : null,
    cargada: n && n.loadEventEnd > 0 ? n.loadEventEnd : null,
    bytesHtml: n ? (n.encodedBodySize || n.transferSize || null) : null,
    precargada: !!n && n.deliveryType === 'navigational-prefetch',
    tipo: n ? n.type : '',
    archivos: propios.length,
    deCache: enCache.length,
    bytesRed: propios.reduce((a, r) => a + (r.transferSize || 0), 0)
  };
}

function useCarga(): Carga {
  const [carga, setCarga] = useState(leerCarga);
  useEffect(() => {
    if (document.readyState === 'complete' && carga.cargada !== null) return;
    const releer = () => setTimeout(() => setCarga(leerCarga()), 0); // loadEventEnd se apunta al salir del evento
    window.addEventListener('load', releer, { once: true });
    return () => window.removeEventListener('load', releer);
  }, [carga.cargada]);
  return carga;
}

/* ── /api/salud: el punto de Cloudflare y D1 (la ÚNICA petición propia, y solo con el panel abierto) ── */

interface Salud {
  ok?: boolean; d1Ms?: number; colo?: string; ciudad?: string; entorno?: string; construido?: string;
  borde?: string; api?: string; separado?: boolean;
}
interface EstadoSalud { estado: 'midiendo' | 'listo' | 'error'; datos: Salud | null; idas: number[]; d1: number[] }

async function medirSalud(): Promise<{ datos: Salud; ida: number }> {
  const t0 = performance.now();
  const r = await fetch('/api/salud', { cache: 'no-store', credentials: 'same-origin' });
  const datos = (await r.json()) as Salud;
  return { datos, ida: Math.round(performance.now() - t0) };
}

function useSalud(retraso: number) {
  const [s, setS] = useState<EstadoSalud>({ estado: 'midiendo', datos: null, idas: [], d1: [] });
  const medir = async (veces: number) => {
    setS((x) => ({ ...x, estado: 'midiendo' }));
    const idas: number[] = [];
    const d1: number[] = [];
    let datos: Salud | null = null;
    try {
      for (let i = 0; i < veces; i++) {
        const m = await medirSalud();
        datos = m.datos;
        idas.push(m.ida);
        if (typeof m.datos.d1Ms === 'number') d1.push(m.datos.d1Ms);
      }
      setS({ estado: 'listo', datos, idas, d1 });
    } catch {
      setS((x) => ({ ...x, estado: 'error' }));
    }
  };
  useEffect(() => {
    const t = setTimeout(() => { void medir(1); }, retraso);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { ...s, medir };
}

/* ── Piezas ──────────────────────────────────────────────────────────────────────────────────── */

const esPortal = () => !!document.getElementById('sec-inicio');
const esLocal = (s: Salud | null) => !!s && (s.entorno === 'local' || /^(localhost|127\.|\[::1\])/.test(location.hostname));
const maestro = () => { try { return localStorage.getItem('ventel-user-role') === 'maestro'; } catch { return false; } };

function Barra({ valor, max, clase, etiqueta }: { valor: number | null; max: number; clase: string; etiqueta: string }) {
  const pct = valor === null || !(max > 0) ? 0 : Math.max(0.6, Math.min(100, (valor / max) * 100));
  return (
    <span className="vx-pista" aria-hidden="true" title={etiqueta}>
      <i className={'vx-barra ' + clase} style={{ width: pct + '%' }} />
    </span>
  );
}

interface FilaComp { etiqueta: string; gas?: CifraGas; valor: number | null; texto?: string; clase: 'vx-gas' | 'vx-gas-piso' | 'vx-cf' }

function Comparacion({ titulo, filas, contra, aqui, pie }: {
  titulo: string; filas: FilaComp[]; contra: CifraGas; aqui: number | null; pie?: ReactNode;
}) {
  const max = Math.max(...filas.map((f) => (f.gas ? f.gas.ms : f.valor || 0)));
  const factor = aqui !== null && aqui > 0 ? veces(contra.ms, aqui) : '';
  return (
    <div className="vx-comp">
      <div className="vx-comp-cab">
        <h4>{titulo}</h4>
        {factor ? <span className="vx-veces" title={'Comparado con ' + contra.texto + ' de Apps Script'}>{factor} más rápido</span> : null}
      </div>
      {filas.map((f) => (
        <div className="vx-fila-barra" key={f.etiqueta}>
          <span className="vx-et">{f.etiqueta}</span>
          <Barra valor={f.gas ? f.gas.ms : f.valor} max={max} clase={f.clase} etiqueta={f.etiqueta} />
          <span className={'vx-valor' + (f.clase === 'vx-cf' ? ' vx-valor-cf' : '')}>
            {f.gas ? <>{f.gas.texto}<sup className="vx-nota">{f.gas.nota}</sup></> : (f.texto || tiempo(f.valor))}
          </span>
        </div>
      ))}
      {pie ? <p className="vx-pie">{pie}</p> : null}
    </div>
  );
}

function nombreLlamada(fn: string): { nombre: string; detalle: string } {
  const lote = /^lote\((.*)\)$/.exec(fn);
  if (!lote) return { nombre: fn, detalle: '' };
  const partes = lote[1].split(',').filter(Boolean);
  return { nombre: 'Lote de ' + partes.length, detalle: partes.join(' · ') };
}

function Llamada({ m, escala, nueva }: { m: MedidaRed; escala: number; nueva: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  const { nombre, detalle } = nombreLlamada(m.fn);
  const srv = m.srv >= 0 ? Math.min(m.srv, m.ms) : null;
  // Una llamada que llega con el panel abierto se ilumina un momento. Solo al montarse: cada llamada
  // es un componente nuevo, y matar el destello en el siguiente repintado lo dejaría a medias.
  useLayoutEffect(() => {
    const g = gsapListo();
    if (!nueva || !g || !ref.current) return;
    const tw = g.fromTo(ref.current.querySelector('.vx-destello'), { opacity: 1 }, { opacity: 0, duration: 1.2, ease: 'power2.out' });
    return () => { tw.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const total = Math.max(0.8, Math.min(100, (m.ms / escala) * 100));
  const parteSrv = srv === null ? 0 : (srv / m.ms) * 100;
  return (
    <li className={'vx-llamada' + (m.ok ? '' : ' vx-llamada-fallo')} ref={ref}>
      <i className="vx-destello" aria-hidden="true" />
      <div className="vx-ll-cab">
        <span className={'vx-punto' + (m.ok ? '' : ' vx-punto-fallo')} aria-hidden="true" />
        <code className="vx-fn" title={m.fn}>{nombre}</code>
        <span className="vx-ll-ms">{tiempo(m.ms)}</span>
      </div>
      {detalle ? <p className="vx-ll-det">{detalle}</p> : null}
      <div className="vx-ll-barra" aria-hidden="true">
        <span className="vx-ll-total" style={{ width: total + '%' }}>
          <span className="vx-ll-srv" style={{ width: parteSrv + '%' }} />
        </span>
      </div>
      <p className="vx-ll-meta">
        {srv === null ? 'El servidor no dijo cuánto trabajó' : <>Servidor <b>{tiempo(srv)}</b> · red y navegador {tiempo(m.ms - srv)}</>}
        <span className="vx-ll-cuando">a los {tiempo(finDe(m))}</span>
        {m.ok ? null : <span className="vx-chip vx-chip-fallo">Falló</span>}
      </p>
    </li>
  );
}

/** Los primeros segundos de la pantalla: el HTML, cuándo quedó lista y las llamadas del arranque. */
function LineaDeTiempo({ carga, arranque }: { carga: Carga; arranque: MedidaRed[] }) {
  const finLlamadas = arranque.reduce((a, m) => Math.max(a, finDe(m)), 0);
  const tope = Math.max(carga.cargada || 0, carga.lista || 0, finLlamadas, 50) * 1.04;
  const pct = (v: number) => Math.max(0, Math.min(100, (v / tope) * 100)) + '%';
  // Carriles para que las llamadas que se enciman no se tapen.
  const carriles: number[] = [];
  const colocadas = arranque.slice().sort((a, b) => inicioDe(a) - inicioDe(b)).map((m) => {
    const ini = Math.max(0, inicioDe(m));
    let c = carriles.findIndex((fin) => fin <= ini);
    if (c === -1) { c = carriles.length; carriles.push(0); }
    carriles[c] = finDe(m) + tope * 0.01;
    return { m, ini, c };
  });
  const filas = Math.min(4, Math.max(1, carriles.length));
  return (
    <div className="vx-tl" role="img" aria-label={'Línea de tiempo: la pantalla quedó lista a los ' + tiempo(carga.lista) +
      (finLlamadas ? ' y la última llamada del arranque terminó a los ' + tiempo(finLlamadas) : '') + '.'}>
      <div className="vx-tl-carril">
        <span className="vx-tl-rot">Página</span>
        <div className="vx-tl-pista">
          {carga.htmlFin !== null ? <span className="vx-tl-html" style={{ width: pct(carga.htmlFin) }} title={'HTML recibido a los ' + tiempo(carga.htmlFin)} /> : null}
          {carga.lista !== null ? <span className="vx-tl-marca" style={{ left: pct(carga.lista) }} title={'Lista a los ' + tiempo(carga.lista)} /> : null}
          {carga.cargada !== null ? <span className="vx-tl-marca vx-tl-marca-2" style={{ left: pct(carga.cargada) }} title={'Cargada a los ' + tiempo(carga.cargada)} /> : null}
        </div>
      </div>
      <div className="vx-tl-carril">
        <span className="vx-tl-rot">Servidor</span>
        <div className="vx-tl-pista" style={{ height: 6 + filas * 7 + 'px' }}>
          {colocadas.filter((x) => x.c < 4).map(({ m, ini, c }, i) => (
            <span key={i} className={'vx-tl-ll' + (m.ok ? '' : ' vx-tl-ll-fallo')}
              style={{ left: pct(ini), width: 'max(3px, ' + pct(m.ms) + ')', top: 3 + c * 7 + 'px' }}
              title={m.fn + ' · ' + tiempo(m.ms)} />
          ))}
        </div>
      </div>
      <div className="vx-tl-eje" aria-hidden="true"><span>0</span><span>{tiempo(tope / 2)}</span><span>{tiempo(tope)}</span></div>
    </div>
  );
}

function Dato({ etiqueta, valor, sub }: { etiqueta: string; valor: ReactNode; sub?: ReactNode }) {
  return (
    <div className="vx-dato">
      <dt>{etiqueta}</dt>
      <dd>{valor}{sub ? <small>{sub}</small> : null}</dd>
    </div>
  );
}

function lugar(sigla?: string): string {
  if (!sigla) return '—';
  return CIUDADES[sigla] ? sigla + ' · ' + CIUDADES[sigla] : sigla;
}

/** Llamadas que se ven de entrada (las más recientes); el resto, con «Ver las N». */
const VISIBLES = 25;

/* ── El panel ────────────────────────────────────────────────────────────────────────────────── */

function Panel({ alCerrar, refPanel, enfocar }: { alCerrar: () => void; refPanel: (el: HTMLElement | null) => void; enfocar: boolean }) {
  const lista = useLlamadas();
  const carga = useCarga();
  // Si el panel se abrió solo (al cambiar de pantalla), espera un poco: que la pantalla haga lo suyo primero.
  const salud = useSalud(enfocar ? 0 : 1200);
  const yaVistas = useRef<number>(lista.length);
  const [todas, setTodas] = useState(false);
  const caja = useRef<HTMLElement | null>(null);

  const buenas = lista.filter((m) => m.ok);
  const med = mediana(buenas.map((m) => m.ms));
  const medSrv = mediana(buenas.filter((m) => m.srv >= 0).map((m) => m.srv));
  const fallidas = lista.length - buenas.length;
  const arranque = lista.filter((m) => inicioDe(m) <= (carga.lista || 0) + 3000);
  const ultimoDato = arranque.length ? Math.max(...arranque.map(finDe)) : null;
  const escala = Math.max(120, ...lista.map((m) => m.ms));
  const portal = esPortal();
  const local = esLocal(salud.datos);

  useEffect(() => { yaVistas.current = lista.length; });

  // Entrada: el panel sube y las barras crecen. Sin GSAP o con movimiento reducido, ya está ahí.
  useLayoutEffect(() => {
    const g = gsapListo();
    const el = caja.current;
    if (!g || !el) return;
    const ctx = g.context(() => {
      g.fromTo(el, { opacity: 0, y: 10, scale: 0.985 }, { opacity: 1, y: 0, scale: 1, duration: 0.28, ease: 'power3.out', clearProps: 'transform,opacity' });
      const barras = el.querySelectorAll('.vx-comp .vx-barra');
      g.from(barras, { scaleX: 0, transformOrigin: '0% 50%', duration: 0.6, ease: 'power3.out', delay: 0.08,
        stagger: { amount: Math.min(0.35, barras.length * 0.05) }, clearProps: 'transform' });
    }, el);
    return () => ctx.revert();
  }, []);

  useLayoutEffect(() => {
    if (enfocar && caja.current) caja.current.focus({ preventScroll: true });
  }, [enfocar]);

  const fijar = (el: HTMLElement | null) => { caja.current = el; refPanel(el); };

  return (
    <section className="vx-panel" id="vx-panel" role="dialog" aria-modal="false" aria-labelledby="vx-titulo" tabIndex={-1} ref={fijar}>
      <header className="vx-cab">
        <div>
          <p className="vx-sobre">Portal en Cloudflare</p>
          <h2 id="vx-titulo">Velocidad de esta pantalla</h2>
          <p className="vx-sub">Medido en tu navegador, ahora mismo.</p>
        </div>
        <button type="button" className="vx-cerrar" onClick={alCerrar} aria-label="Cerrar el panel de velocidad">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </header>

      <div className="vx-cuerpo">
        <section className="vx-sec" aria-labelledby="vx-s-comp">
          <h3 id="vx-s-comp">Contra Apps Script</h3>
          <Comparacion
            titulo="Una llamada al servidor"
            contra={GAS.piso}
            aqui={med}
            filas={[
              { etiqueta: 'Apps Script', gas: GAS.llamada, valor: null, clase: 'vx-gas' },
              { etiqueta: 'Apps Script vacío', gas: GAS.piso, valor: null, clase: 'vx-gas-piso' },
              { etiqueta: 'Aquí', valor: med, texto: med === null ? 'Sin llamadas aún' : undefined, clase: 'vx-cf' }
            ]}
            pie={med === null ? 'En cuanto la pantalla llame al servidor, aparece aquí.'
              : <>Aquí: mediana de {numero(buenas.length)} {buenas.length === 1 ? 'llamada' : 'llamadas'}. Ni un Apps Script vacío baja de 773 ms.</>}
          />
          <Comparacion
            titulo="Primer byte de la página"
            contra={GAS.primerByte}
            aqui={carga.precargada ? null : carga.primerByte}
            filas={[
              { etiqueta: 'Apps Script', gas: GAS.primerByte, valor: null, clase: 'vx-gas' },
              { etiqueta: 'Aquí', valor: carga.precargada ? 0 : carga.primerByte, texto: carga.precargada ? 'Ya estaba aquí' : undefined, clase: 'vx-cf' }
            ]}
            pie={carga.precargada ? 'El navegador la pidió al apuntar el enlace (Speculation Rules): llegó antes del clic.' : undefined}
          />
          <Comparacion
            titulo="Pantalla lista para usarse"
            contra={GAS.pantallaLista}
            aqui={carga.lista}
            filas={[
              { etiqueta: 'Apps Script', gas: GAS.pantallaLista, valor: null, clase: 'vx-gas' },
              { etiqueta: 'Aquí', valor: carga.lista, clase: 'vx-cf' }
            ]}
          />
          {portal ? (
            <Comparacion
              titulo="Todos los datos del Portal"
              contra={GAS.ultimoDato}
              aqui={ultimoDato}
              filas={[
                { etiqueta: 'Apps Script', gas: GAS.ultimoDato, valor: null, clase: 'vx-gas' },
                { etiqueta: 'Aquí', valor: ultimoDato, texto: ultimoDato === null ? 'Esperando' : undefined, clase: 'vx-cf' }
              ]}
              pie="Aquí: cuando terminó la última llamada que salió en los primeros 3 s de la pantalla."
            />
          ) : null}
        </section>

        <section className="vx-sec" aria-labelledby="vx-s-ll">
          <div className="vx-sec-cab">
            <h3 id="vx-s-ll">Llamadas al servidor <span className="vx-cuenta">{numero(lista.length)}</span></h3>
            {med !== null ? <span className="vx-resumen">Mediana {tiempo(med)}{medSrv !== null ? ' · servidor ' + tiempo(medSrv) : ''}{fallidas ? ' · ' + fallidas + ' con error' : ''}</span> : null}
          </div>
          {lista.length ? (
            <>
              <p className="vx-leyenda" aria-hidden="true"><i className="vx-ley-srv" />servidor <i className="vx-ley-red" />red y navegador</p>
              <ol className="vx-llamadas" reversed>
                {lista.slice().reverse().slice(0, todas ? lista.length : VISIBLES).map((m, i) => (
                  <Llamada key={m.t + ':' + m.fn + ':' + (lista.length - i)} m={m} escala={escala} nueva={lista.length - i > yaVistas.current} />
                ))}
              </ol>
              {lista.length > VISIBLES ? (
                <button type="button" className="vx-btn vx-mas" onClick={() => setTodas(!todas)} aria-expanded={todas}>
                  {todas ? 'Ver solo las últimas ' + VISIBLES : 'Ver las ' + numero(lista.length)}
                </button>
              ) : null}
            </>
          ) : (
            <p className="vx-vacio">Esta pantalla todavía no ha llamado al servidor. Haz algo en ella y mira cómo llegan.</p>
          )}
        </section>

        <section className="vx-sec" aria-labelledby="vx-s-carga">
          <h3 id="vx-s-carga">Carga de la página</h3>
          <LineaDeTiempo carga={carga} arranque={arranque} />
          <p className="vx-leyenda" aria-hidden="true"><i className="vx-ley-html" />HTML <i className="vx-ley-marca" />lista y cargada <i className="vx-ley-srv" />llamadas del arranque</p>
          <dl className="vx-datos">
            <Dato etiqueta="Primer byte" valor={carga.precargada ? 'Precargada' : tiempo(carga.primerByte)} />
            <Dato etiqueta="HTML completo" valor={tiempo(carga.htmlFin)} sub={carga.bytesHtml ? bytes(carga.bytesHtml) : undefined} />
            <Dato etiqueta="Lista (DOMContentLoaded)" valor={tiempo(carga.lista)} />
            <Dato etiqueta="Todo cargado (load)" valor={carga.cargada === null ? 'Cargando…' : tiempo(carga.cargada)} />
            <Dato etiqueta="Archivos propios" valor={numero(carga.archivos)} sub={carga.archivos ? numero(carga.deCache) + ' de la caché del navegador' : undefined} />
            <Dato etiqueta="Bajado de la red" valor={bytes(carga.bytesRed + (carga.bytesHtml || 0))} sub={carga.tipo === 'reload' ? 'recargaste la página' : undefined} />
          </dl>
        </section>

        <section className="vx-sec" aria-labelledby="vx-s-cf">
          <div className="vx-sec-cab">
            <h3 id="vx-s-cf">Dónde te atendió Cloudflare</h3>
            {local ? <span className="vx-chip">Local · wrangler dev</span> : null}
          </div>
          {salud.estado === 'error' && !salud.datos ? (
            <p className="vx-vacio">No pudimos medir ahora. Revisa tu conexión y vuelve a intentarlo.</p>
          ) : (
            <dl className="vx-datos" aria-busy={salud.estado === 'midiendo'}>
              <Dato etiqueta="La pantalla salió de" valor={salud.datos ? lugar(salud.datos.borde || salud.datos.colo) : 'Midiendo…'}
                sub={salud.datos ? (local ? 'en local las siglas son de prueba' : 'el punto más cercano a ti') : undefined} />
              <Dato etiqueta="La API y la base, en" valor={salud.datos ? (salud.datos.separado ? lugar(salud.datos.api) : 'El mismo Worker') : '—'}
                sub={salud.datos && salud.datos.separado ? 'junto a la base D1' : (salud.datos ? 'en local todo corre en uno' : undefined)} />
              <Dato etiqueta="D1 contesta en" valor={salud.d1.length ? tiempo(mediana(salud.d1)) : '—'}
                sub={salud.d1.length ? (salud.d1.length > 1 ? 'mediana de ' + salud.d1.length + ' mediciones' : 'una lectura, medida en la API') : undefined} />
              <Dato etiqueta="Ida y vuelta desde aquí" valor={salud.idas.length ? tiempo(mediana(salud.idas)) : '—'}
                sub={salud.idas.length > 1 ? 'mín. ' + tiempo(Math.min(...salud.idas)) + ' en ' + salud.idas.length + ' intentos' : undefined} />
            </dl>
          )}
          <div className="vx-acciones">
            <button type="button" className="vx-btn" onClick={() => void salud.medir(5)} disabled={salud.estado === 'midiendo'}>
              {salud.estado === 'midiendo' ? 'Midiendo…' : 'Medir 5 veces'}
            </button>
            {maestro() ? <a className="vx-enlace" href="/?page=datos">Explorar la base de datos <span aria-hidden="true">→</span></a> : null}
          </div>
          {salud.datos && salud.datos.construido ? <p className="vx-pie">Versión construida el {fechaHora(salud.datos.construido)}.</p> : null}
        </section>

        <section className="vx-sec vx-fuentes" aria-labelledby="vx-s-fuentes">
          <h3 id="vx-s-fuentes">De dónde salen las cifras de Apps Script</h3>
          <ol>
            {FUENTES.map((f) => (
              <li key={f.n} value={f.n}>{f.texto} <span className="vx-archivo">{f.archivo}</span></li>
            ))}
          </ol>
          <p className="vx-pie">Allá, otra red y otro día; aquí, este navegador ahora mismo. La comparación es orientativa: las de Apps Script son las cifras más bajas que se midieron.</p>
        </section>
      </div>
    </section>
  );
}

/* ── Montaje (lo llama main.ts) ──────────────────────────────────────────────────────────────── */

export function montar(o: {
  raiz: ShadowRoot; montaje: HTMLElement; boton: HTMLButtonElement; host: HTMLElement;
  alCerrar(): void; volverAlBoton: boolean;
}) {
  if (!o.raiz.querySelector('style[data-vx-panel]')) {
    const hoja = document.createElement('style');
    hoja.setAttribute('data-vx-panel', '');
    hoja.textContent = estilos;
    o.raiz.appendChild(hoja);
  }
  const raizReact = createRoot(o.montaje);
  let panel: HTMLElement | null = null;
  let cerrando = false;

  const terminar = () => {
    // ¿El foco estaba dentro? Entonces vuelve al botón (si no, no se lo robamos a la pantalla).
    const conFoco = o.raiz.activeElement && o.raiz.activeElement !== o.boton;
    raizReact.unmount();
    o.alCerrar();
    if (conFoco) o.boton.focus();
  };

  const cerrar = () => {
    if (cerrando) return;
    cerrando = true;
    const g = gsapListo();
    if (g && panel) g.to(panel, { opacity: 0, y: 8, duration: 0.16, ease: 'power2.in', onComplete: terminar });
    else terminar();
  };

  raizReact.render(<Panel alCerrar={cerrar} refPanel={(el) => { panel = el; }} enfocar={o.volverAlBoton} />);
  return { cerrar, enfocar: () => panel && panel.focus() };
}
