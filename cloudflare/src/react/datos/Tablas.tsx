/* Pestaña «Tablas»: la lista de tablas de D1 y, al elegir una, sus filas paginadas. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { llamar, esFallo, type RespFilas, type RespFila, type TablaResumen, type Viaje, type Celda } from './api';
import { Icono, Medidor, Rejilla, Huesos, rango, ValorCelda } from './piezas';
import { numero } from '../compartido/formato';

const GRUPOS: Array<[string, (n: string) => boolean]> = [
  ['Cotizaciones', (n) => ['cotizaciones', 'detalle_cotizaciones', 'metricas_correos', 'correos_enviados'].includes(n) || n.startsWith('revision')],
  ['Personas', (n) => ['registros', 'permisos_sistema', 'preferencias_usuario', 'grupos', 'onboarding', 'sesiones'].includes(n)],
  ['Portal', (n) => n.startsWith('portal_')],
  ['Operación', (n) => n.startsWith('operacion_')],
  ['Atenciones', (n) => n.startsWith('atenciones_')],
  ['Trazabilidad', (n) => n.startsWith('trazabilidad_')],
  ['Sistema', (n) => ['propiedades', 'cache', 'contadores', 'correos_salida', 'archivos', 'bitacora_consola', 'metricas_busquedas'].includes(n)]
];

/** Qué es cada tabla, en una línea (sale del comentario de migrations/0001_esquema.sql). */
const QUE_ES: Record<string, string> = {
  propiedades: 'Configuración e interruptores: lo que en Apps Script era PropertiesService.',
  cache: 'Contadores con caducidad: intentos de inicio de sesión, límites por hora.',
  contadores: 'Contadores atómicos, como el de los folios LVP-AAMMDD-XXXX.',
  sesiones: 'Sesiones abiertas. Se guarda la huella de la llave, nunca la llave.',
  correos_salida: 'La bandeja de salida: cada correo, completo, con lo que pasó al mandarlo.',
  archivos: 'Imágenes y evidencias subidas. El archivo vive en R2.',
  registros: 'Las personas. El correo es la clave de todo el sistema.',
  permisos_sistema: 'Rol y permisos de cada persona.',
  preferencias_usuario: 'Las preferencias de cada persona.',
  bitacora_consola: 'Quién cambió qué en la consola (y quién consultó la base).',
  metricas_correos: 'Cada correo enviado por los tres canales.',
  metricas_busquedas: 'Qué busca el equipo en el Portal.',
  grupos: 'Listas de personas. No dan permisos.',
  correos_enviados: 'Plantillas enviadas a clientes.',
  onboarding: 'Qué tutorial vio cada persona.',
  cotizaciones: 'La cabecera de cada cotización.',
  detalle_cotizaciones: 'Las partidas de cada cotización.',
  atenciones_pendientes: 'Atenciones pospuestas: datos personales de clientes.',
  atenciones_tipos: 'Catálogo de tipos de atención (se alimenta solo).',
  operacion_reportes: 'Cada aviso de un asesor sobre un sistema.',
  operacion_incidentes: 'Las fallas agregadas de los sistemas.',
  operacion_actualizaciones: 'El historial de cada incidencia.',
  operacion_catalogo: 'Sistemas, motivos y estados de Operación.',
  trazabilidad_secciones: 'Las secciones de los procesos homologados.',
  trazabilidad_procesos: 'Los procesos homologados, uno por fila.'
};

function grupoDe(n: string): string {
  const g = GRUPOS.find(([, f]) => f(n));
  return g ? g[0] : 'Otras';
}

interface Consulta { pagina: number; porPagina: number; orden: string; dir: 'asc' | 'desc'; filtro: string }
const INICIAL: Consulta = { pagina: 1, porPagina: 50, orden: '', dir: 'asc', filtro: '' };

export function Tablas({ email, tablas, tabla, alElegir, alFallar }: {
  email: string; tablas: TablaResumen[]; tabla: string;
  alElegir: (t: string) => void; alFallar: (e: unknown) => void;
}) {
  const [busca, setBusca] = useState('');
  const [consulta, setConsulta] = useState<Consulta>(INICIAL);
  const [filtroEscrito, setFiltroEscrito] = useState('');
  const [datos, setDatos] = useState<RespFilas | null>(null);
  const [viaje, setViaje] = useState<Viaje | null>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [detalle, setDetalle] = useState<number | null>(null);
  const turno = useRef(0);

  const actual = tablas.find((t) => t.nombre === tabla) || null;

  // Al cambiar de tabla, la consulta vuelve a empezar.
  useEffect(() => { setConsulta(INICIAL); setFiltroEscrito(''); setDetalle(null); setDatos(null); }, [tabla]);

  // El filtro se aplica cuando dejas de escribir.
  useEffect(() => {
    const t = setTimeout(() => setConsulta((c) => (c.filtro === filtroEscrito.trim() ? c : { ...c, filtro: filtroEscrito.trim(), pagina: 1 })), 300);
    return () => clearTimeout(t);
  }, [filtroEscrito]);

  useEffect(() => {
    if (!actual) return;
    const yo = ++turno.current;
    setCargando(true);
    setError('');
    llamar<RespFilas>('datosFilas', [email, actual.nombre, consulta]).then(({ r, viaje }) => {
      if (yo !== turno.current) return;
      if (esFallo(r)) { setError(r.message); setDatos(null); }
      else { setDatos(r); setViaje(viaje); }
    }, (e) => { if (yo === turno.current) { alFallar(e); setError(String((e && e.message) || e)); } })
      .finally(() => { if (yo === turno.current) setCargando(false); });
  }, [email, actual && actual.nombre, consulta]); // eslint-disable-line react-hooks/exhaustive-deps

  const grupos = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const mapa = new Map<string, TablaResumen[]>();
    for (const t of tablas) {
      if (q && t.nombre.toLowerCase().indexOf(q) === -1) continue;
      const g = grupoDe(t.nombre);
      if (!mapa.has(g)) mapa.set(g, []);
      mapa.get(g)!.push(t);
    }
    return [...GRUPOS.map(([g]) => g), 'Otras'].filter((g) => mapa.has(g)).map((g) => [g, mapa.get(g)!] as const);
  }, [tablas, busca]);

  const totalFilas = tablas.reduce((a, t) => a + t.filas, 0);
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1;
  const ordenar = (col: string) => setConsulta((c) => ({ ...c, pagina: 1, orden: col, dir: c.orden === col && c.dir === 'asc' ? 'desc' : 'asc' }));

  return (
    <div className="vista vista-tablas">
      <aside className="lado tarjeta" aria-label="Tablas de la base">
        <div className="lado-cab">
          <h2>Tablas</h2>
          <span>{numero(tablas.length)} · {numero(totalFilas)} filas</span>
        </div>
        <label className="campo">
          <Icono n="buscar" />
          <span className="sr">Buscar una tabla</span>
          <input type="search" placeholder="Buscar tabla…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
        <select className="selector selector-movil" aria-label="Tabla" value={tabla} onChange={(e) => alElegir(e.target.value)}>
          {tablas.map((t) => <option key={t.nombre} value={t.nombre}>{t.nombre} · {numero(t.filas)}</option>)}
        </select>
        <nav className="lista-tablas" aria-label="Elegir tabla">
          {grupos.map(([g, lista]) => (
            <div key={g} role="group" aria-label={g}>
              <p className="grupo-rot">{g}</p>
              {lista.map((t) => (
                <button key={t.nombre} type="button" className="item-tabla" aria-current={t.nombre === tabla} onClick={() => alElegir(t.nombre)}>
                  <code>{t.nombre}</code>
                  <span className="n">
                    {t.columnas.some((c) => c.oculta) ? <Icono n="candado" titulo="Tiene columnas ocultas" /> : null} {numero(t.filas)}
                  </span>
                </button>
              ))}
            </div>
          ))}
          {!grupos.length ? <p className="lado-pie">Ninguna tabla se llama así.</p> : null}
        </nav>
        <p className="lado-pie">Lo secreto (contraseñas, huellas de sesión, claves) sale como <b>oculto</b>: no viaja ni para el maestro.</p>
      </aside>

      <section className="principal tarjeta" aria-labelledby="titulo-tabla">
        {!actual ? (
          <div className="visor-vacio">
            <Icono n="tabla" />
            <b>Elige una tabla</b>
            <p>A la izquierda está toda la base, agrupada como el Portal: cotizaciones, personas, contenido, operación y sistema.</p>
          </div>
        ) : (
          <>
            <header className="principal-cab">
              <div className="titulo-tabla">
                <span className="sobre">{grupoDe(actual.nombre)}</span>
                <h1 id="titulo-tabla">{actual.nombre}</h1>
                <p>{QUE_ES[actual.nombre] ? QUE_ES[actual.nombre] + ' ' : ''}{numero(datos ? datos.total : actual.filas)} {(datos ? datos.total : actual.filas) === 1 ? 'fila' : 'filas'}{datos && datos.filtro ? ' con «' + datos.filtro + '»' : ''} · {actual.columnas.length} columnas</p>
              </div>
              <div className="controles">
                <label className="campo">
                  <Icono n="buscar" />
                  <span className="sr">Filtrar filas</span>
                  <input type="search" placeholder="Filtrar filas…" value={filtroEscrito} onChange={(e) => setFiltroEscrito(e.target.value)} />
                </label>
                <select className="selector" aria-label="Filas por página" value={consulta.porPagina}
                  onChange={(e) => setConsulta((c) => ({ ...c, pagina: 1, porPagina: Number(e.target.value) }))}>
                  {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} por página</option>)}
                </select>
              </div>
            </header>
            <div className="barra-estado">
              <Medidor d1={datos ? datos.d1 : null} viaje={viaje} filas />
              <span className="nota" aria-live="polite">
                {cargando ? 'Consultando…' : (actual.columnas.some((c) => c.oculta) ? <><Icono n="candado" />Esta tabla tiene columnas ocultas</> : <><Icono n="info" />Toca una fila para verla completa</>)}
              </span>
            </div>
            {error ? <div className="aviso aviso-error" role="alert" style={{ margin: '1rem 1.15rem' }}><Icono n="alerta" />{error}</div> : null}
            <div className="rejilla-envoltura" aria-busy={cargando}>
              {datos ? (
                datos.filas.length ? (
                  <Rejilla
                    etiqueta={'Filas de ' + datos.tabla}
                    columnas={datos.columnas}
                    filas={datos.filas.map((f, i) => ({ clave: f.rowid !== null ? String(f.rowid) : 'i' + i, celdas: f.celdas }))}
                    orden={datos.orden} dir={datos.dir}
                    alOrdenar={ordenar}
                    alElegir={(clave) => { if (/^\d+$/.test(clave)) setDetalle(Number(clave)); }}
                    elegida={detalle !== null ? String(detalle) : undefined}
                    desde={(datos.pagina - 1) * datos.porPagina + 1}
                  />
                ) : (
                  <div className="vacio-rejilla">
                    <b>{datos.filtro ? 'Nada coincide con «' + datos.filtro + '»' : 'Esta tabla está vacía'}</b>
                    {datos.filtro ? 'El filtro busca en todas las columnas que se pueden ver.' : 'Cuando el Portal escriba en ella, aquí aparecerá.'}
                  </div>
                )
              ) : (!error ? <Huesos columnas={Math.min(6, actual.columnas.length)} filas={8} /> : null)}
            </div>
            <footer className="paginacion">
              <span>{datos ? rango(datos.pagina, datos.porPagina, datos.total) : ' '}</span>
              <div className="botones">
                <button type="button" className="btn btn-chico" disabled={!datos || datos.pagina <= 1 || cargando}
                  onClick={() => setConsulta((c) => ({ ...c, pagina: Math.max(1, c.pagina - 1) }))}>
                  <Icono n="izq" />Anterior
                </button>
                <span>Página {datos ? numero(datos.pagina) : 1} de {numero(paginas)}</span>
                <button type="button" className="btn btn-chico" disabled={!datos || datos.pagina >= paginas || cargando}
                  onClick={() => setConsulta((c) => ({ ...c, pagina: c.pagina + 1 }))}>
                  Siguiente<Icono n="der" />
                </button>
              </div>
            </footer>
          </>
        )}
      </section>

      {actual && detalle !== null ? (
        <DetalleFila email={email} tabla={actual.nombre} rowid={detalle} alCerrar={() => setDetalle(null)} alFallar={alFallar} />
      ) : null}
    </div>
  );
}

function jsonBonito(v: Celda): string | null {
  if (typeof v !== 'string' || !/^\s*[[{]/.test(v)) return null;
  try { return JSON.stringify(JSON.parse(v), null, 2); } catch { return null; }
}

function DetalleFila({ email, tabla, rowid, alCerrar, alFallar }: {
  email: string; tabla: string; rowid: number; alCerrar: () => void; alFallar: (e: unknown) => void;
}) {
  const [fila, setFila] = useState<RespFila | null>(null);
  const [error, setError] = useState('');
  const caja = useRef<HTMLElement>(null);
  const antes = useRef<Element | null>(document.activeElement);

  useEffect(() => {
    let vivo = true;
    setFila(null);
    llamar<RespFila>('datosFila', [email, tabla, rowid]).then(({ r }) => {
      if (!vivo) return;
      if (esFallo(r)) setError(r.message); else setFila(r);
    }, (e) => { if (vivo) { alFallar(e); setError(String((e && e.message) || e)); } });
    return () => { vivo = false; };
  }, [email, tabla, rowid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Foco al abrir y de vuelta a la fila al cerrar; Escape cierra. Una sola vez: alCerrar cambia en cada pintado.
  const cerrar = useRef(alCerrar);
  cerrar.current = alCerrar;
  useEffect(() => {
    caja.current?.focus();
    const previo = antes.current;
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar.current(); };
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('keydown', tecla);
      if (previo instanceof HTMLElement) previo.focus();
    };
  }, []);

  return (
    <>
      <div className="detalle-fondo" onClick={alCerrar} aria-hidden="true" />
      <aside className="detalle" role="dialog" aria-modal="true" aria-labelledby="detalle-titulo" tabIndex={-1} ref={caja}>
        <header className="detalle-cab">
          <div>
            <h2 id="detalle-titulo"><code>{tabla}</code></h2>
            <p>Fila {numero(rowid)}{fila ? ' · ' + fila.campos.length + ' campos' : ''}</p>
          </div>
          <button type="button" className="btn btn-icono" onClick={alCerrar} aria-label="Cerrar el detalle"><Icono n="cerrar" /></button>
        </header>
        <div className="detalle-cuerpo">
          {error ? <div className="aviso aviso-error" role="alert"><Icono n="alerta" />{error}</div> : null}
          {!fila && !error ? <Huesos columnas={1} filas={6} /> : null}
          {fila ? (
            <dl>
              {fila.campos.map((c) => {
                const json = jsonBonito(c.valor);
                return (
                  <div className="campo-detalle" key={c.nombre}>
                    <dt><code>{c.nombre}</code>{c.tipo ? <span>{c.tipo}</span> : null}{c.pk ? <span className="chip chip-info">PK</span> : null}</dt>
                    <dd>{json ? <pre>{json}</pre> : <ValorCelda v={c.valor} />}</dd>
                  </div>
                );
              })}
            </dl>
          ) : null}
          {fila ? <p className="lado-pie" style={{ marginTop: '.8rem' }}><Medidor d1={fila.d1} /></p> : null}
        </div>
      </aside>
    </>
  );
}
