/*
 * Pestaña «Bandeja de salida»: los correos que el Portal «envió». En esta versión no sale ninguno
 * (no hay Gmail): quedan completos en correos_salida, y aquí se ve exactamente lo que habría
 * recibido el cliente. El HTML va en un <iframe sandbox> sin scripts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { llamar, esFallo, type RespCorreos, type RespCorreo, type Viaje } from './api';
import { Icono, Medidor } from './piezas';
import { numero, fechaHora, haceCuanto, hora, bytes } from '../compartido/formato';

const TIPOS: Record<string, [string, string]> = {
  cotizacion: ['Cotización', 'chip-rosa'],
  cuenta: ['Cuenta', 'chip-info'],
  plantilla: ['Plantilla', 'chip-violeta'],
  difusion: ['Difusión', 'chip-aviso'],
  revision: ['Revisión', 'chip-ok']
};
const etiquetaTipo = (t: string) => (TIPOS[t] ? TIPOS[t][0] : (t || 'Sin tipo'));
const claseTipo = (t: string) => (TIPOS[t] ? TIPOS[t][1] : '');

/**
 * El HTML del correo, listo para el iframe: los enlaces se abren aparte, no se manda el Referer al
 * cargar imágenes de fuera, y una política que no deja ejecutar nada (además del sandbox).
 */
function documentoSeguro(html: string): string {
  const cabeza = '<meta charset="utf-8"><base target="_blank"><meta name="referrer" content="no-referrer">' +
    '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'; object-src \'none\'; frame-src \'none\'; form-action \'none\'">';
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + cabeza);
  return '<!doctype html><html><head>' + cabeza + '</head><body>' + html + '</body></html>';
}

export function Bandeja({ email, correo, alElegir, alFallar, alContar }: {
  email: string; correo: number | null; alElegir: (id: number | null) => void;
  alFallar: (e: unknown) => void; alContar: (n: number) => void;
}) {
  const [filtroEscrito, setFiltroEscrito] = useState('');
  const [filtro, setFiltro] = useState('');
  const [tipo, setTipo] = useState('');
  const [pagina, setPagina] = useState(1);
  const [lista, setLista] = useState<RespCorreos | null>(null);
  const [error, setError] = useState('');
  const turno = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => { setFiltro(filtroEscrito.trim()); setPagina(1); }, 300);
    return () => clearTimeout(t);
  }, [filtroEscrito]);

  useEffect(() => {
    const yo = ++turno.current;
    llamar<RespCorreos>('datosCorreos', [email, { pagina, porPagina: 30, filtro, tipo }]).then(({ r }) => {
      if (yo !== turno.current) return;
      if (esFallo(r)) { setError(r.message); return; }
      setError('');
      setLista(r);
      if (!filtro && !tipo) alContar(r.total);
      // En escritorio, el más reciente se abre solo.
      if (correo === null && r.correos.length && window.matchMedia('(min-width: 901px)').matches) alElegir(r.correos[0].id);
    }, (e) => { if (yo === turno.current) { alFallar(e); setError(String((e && e.message) || e)); } });
  }, [email, pagina, filtro, tipo]); // eslint-disable-line react-hooks/exhaustive-deps

  const paginas = lista ? Math.max(1, Math.ceil(lista.total / lista.porPagina)) : 1;
  const totalTodos = useMemo(() => (lista ? lista.tipos.reduce((a, t) => a + t.n, 0) : 0), [lista]);

  return (
    <div className={'vista vista-bandeja' + (correo !== null ? ' con-correo' : '')}>
      <aside className="bandeja-lista tarjeta" aria-label="Correos">
        <div className="bandeja-filtros">
          <h2>Bandeja de salida <span>{lista ? numero(lista.total) + (lista.total === 1 ? ' correo' : ' correos') : ''}</span></h2>
          <label className="campo">
            <Icono n="buscar" />
            <span className="sr">Buscar en la bandeja</span>
            <input type="search" placeholder="Asunto, destinatario, folio…" value={filtroEscrito} onChange={(e) => setFiltroEscrito(e.target.value)} />
          </label>
          <select className="selector" aria-label="Tipo de correo" value={tipo} onChange={(e) => { setTipo(e.target.value); setPagina(1); }}>
            <option value="">Todos los tipos{totalTodos ? ' · ' + numero(totalTodos) : ''}</option>
            {(lista ? lista.tipos : []).map((t) => <option key={t.tipo} value={t.tipo}>{etiquetaTipo(t.tipo)} · {numero(t.n)}</option>)}
          </select>
        </div>
        {error ? <div className="aviso aviso-error" role="alert" style={{ margin: '.75rem' }}><Icono n="alerta" />{error}</div> : null}
        <ul className="correos">
          {lista && lista.correos.map((c) => (
            <li key={c.id}>
              <button type="button" className="correo-item" aria-current={c.id === correo} onClick={() => alElegir(c.id)}>
                <span className="asunto">{c.asunto || '(sin asunto)'}</span>
                <span className="para">Para {c.para || '—'}</span>
                <span className="pie">
                  <span className={'chip ' + claseTipo(c.tipo)}>{etiquetaTipo(c.tipo)}</span>
                  {c.adjuntos ? <Icono n="clip" titulo={c.adjuntos + ' adjunto(s)'} /> : null}
                  {c.codigoVigenteHasta ? <span className="chip chip-aviso" title="Lleva un código de acceso que todavía vale">Código vigente</span> : null}
                  <time dateTime={c.fecha}>{haceCuanto(c.fecha)}</time>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {lista && !lista.correos.length ? (
          <div className="visor-vacio" style={{ minHeight: '12rem' }}>
            <Icono n="correo" />
            <b>{filtro || tipo ? 'Ningún correo coincide' : 'Todavía no sale ningún correo'}</b>
            <p>{filtro || tipo ? 'Prueba con otra búsqueda.' : 'Cuando alguien envíe una cotización o una plantilla, aquí verás lo que habría recibido el cliente.'}</p>
          </div>
        ) : null}
        {lista && paginas > 1 ? (
          <div className="paginacion">
            <button type="button" className="btn btn-chico" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)} aria-label="Correos más recientes"><Icono n="izq" /></button>
            <span>{numero(pagina)} de {numero(paginas)}</span>
            <button type="button" className="btn btn-chico" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)} aria-label="Correos anteriores"><Icono n="der" /></button>
          </div>
        ) : null}
      </aside>

      <section className="visor tarjeta" aria-label="Correo">
        {correo === null ? (
          <div className="visor-vacio">
            <Icono n="correo" />
            <b>Elige un correo</b>
            <p>Verás quién lo mandó, a quién, con qué copias y el correo tal cual lo habría recibido el cliente.</p>
          </div>
        ) : <VistaCorreo key={correo} email={email} id={correo} alVolver={() => alElegir(null)} alFallar={alFallar} />}
      </section>
    </div>
  );
}

function VistaCorreo({ email, id, alVolver, alFallar }: { email: string; id: number; alVolver: () => void; alFallar: (e: unknown) => void }) {
  const [datos, setDatos] = useState<RespCorreo | null>(null);
  const [viaje, setViaje] = useState<Viaje | null>(null);
  const [error, setError] = useState('');
  const [modo, setModo] = useState<'html' | 'texto'>('html');

  useEffect(() => {
    let vivo = true;
    llamar<RespCorreo>('datosCorreo', [email, id]).then(({ r, viaje }) => {
      if (!vivo) return;
      if (esFallo(r)) setError(r.message);
      else { setDatos(r); setViaje(viaje); if (!r.correo.html && r.correo.texto) setModo('texto'); }
    }, (e) => { if (vivo) { alFallar(e); setError(String((e && e.message) || e)); } });
    return () => { vivo = false; };
  }, [email, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const srcdoc = useMemo(() => (datos && datos.correo.html ? documentoSeguro(datos.correo.html) : ''), [datos]);

  if (error) {
    return (
      <div className="visor-vacio">
        <button type="button" className="btn btn-chico atras-movil" onClick={alVolver}><Icono n="volver" />Bandeja</button>
        <div className="aviso aviso-error" role="alert"><Icono n="alerta" />{error}</div>
      </div>
    );
  }
  if (!datos) return <div className="cargando-app" style={{ minHeight: '28rem' }}><span className="giro" aria-hidden="true" />Abriendo el correo…</div>;
  const c = datos.correo;
  return (
    <>
      <header className="visor-cab">
        <button type="button" className="btn btn-chico atras-movil" onClick={alVolver}><Icono n="volver" />Bandeja</button>
        <div className="sobre">
          <span className={'chip ' + claseTipo(c.tipo)}>{etiquetaTipo(c.tipo)}</span>
          {c.referencia ? <span className="chip mono">{c.referencia}</span> : null}
          {c.codigoVigenteHasta ? (
            <span className="chip chip-aviso" title="Un código de acceso vale 10 minutos (el vale de contraseña, 15)">
              <Icono n="reloj" />Lleva un código que vale hasta las {hora(c.codigoVigenteHasta)}
            </span>
          ) : null}
        </div>
        <h1>{c.asunto || '(sin asunto)'}</h1>
        <dl className="sobre-datos">
          <dt>De</dt><dd>{c.nombreDe ? <>{c.nombreDe} <small>&lt;{c.de}&gt;</small></> : c.de}</dd>
          <dt>Para</dt><dd>{c.para || '—'}</dd>
          {c.cc ? <><dt>CC</dt><dd>{c.cc}</dd></> : null}
          {c.cco ? <><dt>CCO</dt><dd>{c.cco}</dd></> : null}
          {c.responderA ? <><dt>Responder a</dt><dd>{c.responderA}</dd></> : null}
          <dt>Fecha</dt><dd>{fechaHora(c.fecha)} <small>· {haceCuanto(c.fecha)}</small></dd>
        </dl>
        {c.adjuntos.length ? (
          <div className="adjuntos" aria-label="Adjuntos">
            {c.adjuntos.map((a, i) => (
              <span key={i} className="adjunto" title={a.tipo}><Icono n="clip" />{a.nombre}{a.bytes ? ' · ' + bytes(a.bytes) : ''}</span>
            ))}
          </div>
        ) : null}
      </header>
      <div className="visor-herr">
        <div className="segmento" role="group" aria-label="Cómo verlo">
          <button type="button" aria-pressed={modo === 'html'} disabled={!c.html} onClick={() => setModo('html')}>Como lo ve el cliente</button>
          <button type="button" aria-pressed={modo === 'texto'} disabled={!c.texto} onClick={() => setModo('texto')}>Texto</button>
        </div>
        <Medidor d1={datos.d1} viaje={viaje} />
      </div>
      <div className="papel">
        {modo === 'html' && srcdoc ? (
          <iframe title={'Correo: ' + (c.asunto || 'sin asunto')} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={srcdoc} referrerPolicy="no-referrer" />
        ) : (
          <pre>{c.texto || 'Este correo no trae versión de texto.'}</pre>
        )}
      </div>
    </>
  );
}
