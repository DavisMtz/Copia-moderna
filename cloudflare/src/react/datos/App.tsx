/*
 * =================================================================================================
 * Explorador de la base de datos (?page=datos) | Portal Ventel en Cloudflare
 * =================================================================================================
 * Pantalla NUEVA de esta versión, solo para el rol maestro: las tablas de D1, una consola de solo
 * lectura y la bandeja de salida (lo que «habría recibido» cada cliente). Usa la sesión que dejó el
 * inicio de sesión del Portal; la puerta de verdad está en el servidor (modulos/nuevas.ts).
 * La dirección guarda dónde estás: #tablas/<tabla>, #consola, #bandeja/<id>.
 * =================================================================================================
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { llamar, esFallo, sesion, SinSesion, SinPermiso, type RespTablas } from './api';
import { Icono } from './piezas';
import { Tablas } from './Tablas';
import { Consola } from './Consola';
import { Bandeja } from './Bandeja';
import { numero, bytes } from '../compartido/formato';

type Vista = 'tablas' | 'consola' | 'bandeja';
interface Ruta { vista: Vista; tabla: string; correo: number | null }
type Fase =
  | { f: 'revisando' }
  | { f: 'sin-sesion'; motivo: string }
  | { f: 'sin-permiso'; motivo: string }
  | { f: 'error'; motivo: string }
  | { f: 'lista'; tablas: RespTablas };

function leerRuta(): Ruta {
  const [vista, resto] = decodeURIComponent(location.hash.replace(/^#/, '')).split('/');
  if (vista === 'consola') return { vista: 'consola', tabla: '', correo: null };
  if (vista === 'bandeja') return { vista: 'bandeja', tabla: '', correo: /^\d+$/.test(resto || '') ? Number(resto) : null };
  return { vista: 'tablas', tabla: resto || '', correo: null };
}

function escribirRuta(r: Ruta) {
  const h = r.vista === 'consola' ? '#consola' : r.vista === 'bandeja' ? '#bandeja' + (r.correo !== null ? '/' + r.correo : '')
    : '#tablas' + (r.tabla ? '/' + encodeURIComponent(r.tabla) : '');
  if (location.hash !== h) history.replaceState(null, '', location.pathname + location.search + h);
}

const PESTANAS: Array<[Vista, string, string, string]> = [
  ['tablas', 'Tablas', 'Tablas', 'tabla'],
  ['consola', 'Consola SQL', 'Consola', 'consola'],
  ['bandeja', 'Bandeja de salida', 'Bandeja', 'correo']
];

const TEMAS: Array<[string, string]> = [['aurora', 'Aurora'], ['slate', 'Slate'], ['carbon', 'Carbón']];

export function App() {
  const s = sesion();
  const [fase, setFase] = useState<Fase>(s.llave ? { f: 'revisando' } : { f: 'sin-sesion', motivo: '' });
  const [ruta, setRuta] = useState<Ruta>(leerRuta);
  const [tema, setTema] = useState(() => document.documentElement.getAttribute('data-theme') || 'aurora');
  const [correos, setCorreos] = useState<number | null>(null);
  const pestanas = useRef<Array<HTMLButtonElement | null>>([]);

  const alFallar = useCallback((e: unknown) => {
    if (e instanceof SinSesion) setFase({ f: 'sin-sesion', motivo: e.message });
    else if (e instanceof SinPermiso) setFase({ f: 'sin-permiso', motivo: e.message });
  }, []);

  useEffect(() => {
    if (!s.llave) return;
    llamar<RespTablas>('datosTablas', [s.email]).then(({ r }) => {
      if (esFallo(r)) setFase({ f: 'error', motivo: r.message });
      else {
        setFase({ f: 'lista', tablas: r });
        const salida = r.tablas.find((t) => t.nombre === 'correos_salida');
        if (salida) setCorreos(salida.filas);
      }
    }, (e) => {
      if (e instanceof SinSesion || e instanceof SinPermiso) alFallar(e);
      else setFase({ f: 'error', motivo: String((e && e.message) || e) });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cambio = () => setRuta(leerRuta());
    window.addEventListener('hashchange', cambio);
    return () => window.removeEventListener('hashchange', cambio);
  }, []);

  // Sin tabla elegida, la primera que dice algo: las cotizaciones.
  useEffect(() => {
    if (fase.f !== 'lista' || ruta.vista !== 'tablas') return;
    const nombres = fase.tablas.tablas.map((t) => t.nombre);
    if (!ruta.tabla || nombres.indexOf(ruta.tabla) === -1) {
      const r = { ...ruta, tabla: nombres.indexOf('cotizaciones') !== -1 ? 'cotizaciones' : (nombres[0] || '') };
      setRuta(r);
      escribirRuta(r);
    }
  }, [fase, ruta]);

  useEffect(() => {
    document.title = (ruta.vista === 'consola' ? 'Consola' : ruta.vista === 'bandeja' ? 'Bandeja de salida' : (ruta.tabla || 'Tablas')) + ' · Datos · Portal Ventel';
  }, [ruta]);

  const ir = (r: Partial<Ruta>) => {
    const nueva = { ...ruta, ...r };
    setRuta(nueva);
    escribirRuta(nueva);
  };

  const cambiarTema = (t: string) => {
    setTema(t);
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('ventel-theme', t); } catch { /* sin almacenamiento */ }
  };

  const teclaPestana = (e: KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const n = PESTANAS.length;
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
    ir({ vista: PESTANAS[j][0] });
    pestanas.current[j]?.focus();
  };

  if (fase.f === 'sin-sesion' || fase.f === 'sin-permiso' || fase.f === 'error') return <Puerta fase={fase} />;

  return (
    <div className="app">
      <header className="barra">
        <a className="marca" href="/?page=datos" onClick={(e) => { e.preventDefault(); ir({ vista: 'tablas' }); }}>
          <span className="marca-ic"><Icono n="base" /></span>
          <span className="marca-tx"><b>Ventel</b><span>Explorador de datos</span></span>
        </a>
        <div className="pestanas" role="tablist" aria-label="Secciones">
          {PESTANAS.map(([v, t, corto, ic], i) => (
            <button key={v} type="button" role="tab" id={'pestana-' + v} className="pestana" aria-selected={ruta.vista === v}
              aria-controls="vista" tabIndex={ruta.vista === v ? 0 : -1} ref={(el) => { pestanas.current[i] = el; }}
              onClick={() => ir({ vista: v })} onKeyDown={(e) => teclaPestana(e, i)}
              aria-label={t + (v === 'bandeja' && correos ? ', ' + correos + (correos === 1 ? ' correo' : ' correos') : '')}>
              <Icono n={ic} /><span className="largo">{t}</span><span className="corto" aria-hidden="true">{corto}</span>
              {v === 'bandeja' && correos ? <span className="cuenta">{numero(correos)}</span> : null}
            </button>
          ))}
        </div>
        <div className="quien">
          <span className="persona"><b>{s.nombre || s.email}</b><span>Maestro{fase.f === 'lista' && fase.tablas.bytes ? ' · base de ' + bytes(fase.tablas.bytes) : ''}</span></span>
          <select className="tema" aria-label="Tema" value={tema} onChange={(e) => cambiarTema(e.target.value)}>
            {TEMAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
          <a className="volver" href="/"><Icono n="volver" /><span>Portal</span></a>
        </div>
      </header>
      <main className="contenido" id="vista" role="tabpanel" aria-labelledby={'pestana-' + ruta.vista}>
        {fase.f === 'revisando' ? (
          <div className="cargando-app" role="status"><span className="giro" aria-hidden="true" />Abriendo la base…</div>
        ) : ruta.vista === 'consola' ? (
          <Consola email={s.email} alFallar={alFallar} />
        ) : ruta.vista === 'bandeja' ? (
          <Bandeja email={s.email} correo={ruta.correo} alElegir={(id) => ir({ correo: id })} alFallar={alFallar} alContar={setCorreos} />
        ) : (
          <Tablas email={s.email} tablas={fase.tablas.tablas} tabla={ruta.tabla} alElegir={(t) => ir({ tabla: t })} alFallar={alFallar} />
        )}
      </main>
    </div>
  );
}

function Puerta({ fase }: { fase: Fase }) {
  const sinPermiso = fase.f === 'sin-permiso';
  const error = fase.f === 'error';
  const crudo = 'motivo' in fase ? fase.motivo : '';
  // El texto genérico de secIdentidadMaestra habla de «la consola»: aquí ya lo dice la tarjeta.
  const motivo = sinPermiso && !/baja/i.test(crudo) ? '' : crudo;
  return (
    <main className="puerta">
      <section className="puerta-tarjeta tarjeta" aria-labelledby="puerta-titulo">
        <span className="marca">
          <span className="marca-ic"><Icono n={sinPermiso ? 'escudo' : 'base'} /></span>
          <span className="marca-tx"><b>Ventel</b><span>Explorador de datos</span></span>
        </span>
        <h1 id="puerta-titulo">
          {error ? 'No pudimos abrir la base' : sinPermiso ? 'Esta pantalla es del rol maestro' : 'Inicia sesión para ver la base'}
        </h1>
        <p>
          {error ? 'Vuelve a intentarlo en un momento. Si sigue igual, avisa al equipo del sistema con la hora exacta.'
            : sinPermiso ? 'Aquí se ve toda la base de datos del Portal, y por eso solo entra el rol maestro. Si necesitas un dato, pídeselo a quien administra el Portal.'
              : 'El explorador de datos usa tu sesión del Portal. Entra con tu cuenta de maestro y vuelve a esta dirección.'}
        </p>
        <div className="acciones">
          {sinPermiso ? <a className="btn btn-primario" href="/">Volver al Portal</a>
            : error ? <button type="button" className="btn btn-primario" onClick={() => location.reload()}>Reintentar</button>
              : <a className="btn btn-primario" href="/?page=login">Iniciar sesión</a>}
          {!sinPermiso ? <a className="btn" href="/">Ir al Portal</a> : null}
        </div>
        {motivo ? <p className="detalle-error">{motivo}</p> : null}
      </section>
    </main>
  );
}
