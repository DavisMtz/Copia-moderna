/* Pestaña «Consola»: SQL de SOLO LECTURA contra D1 (las reglas las aplica el servidor: modulos/nuevas.ts). */
import { useRef, useState } from 'react';
import { llamar, esFallo, type RespConsulta, type Viaje } from './api';
import { Icono, Medidor, Rejilla } from './piezas';
import { numero } from '../compartido/formato';

const EJEMPLOS: Array<[string, string]> = [
  ['Cotizaciones por estatus',
    'SELECT estatus, COUNT(*) AS cotizaciones, ROUND(SUM(total_general), 2) AS total\nFROM cotizaciones\nGROUP BY estatus\nORDER BY cotizaciones DESC'],
  ['Lo más cotizado',
    'SELECT sku, descripcion_producto, SUM(cantidad) AS piezas, COUNT(DISTINCT folio_cotizacion) AS cotizaciones\nFROM detalle_cotizaciones\nGROUP BY sku, descripcion_producto\nORDER BY piezas DESC\nLIMIT 20'],
  ['Quién tiene qué rol',
    'SELECT p.email, r.nombre, p.rol, p.activo\nFROM permisos_sistema p\nLEFT JOIN registros r ON r.email = p.email\nORDER BY p.rol, p.email'],
  ['Correos por tipo',
    'SELECT tipo, COUNT(*) AS correos, MAX(fecha) AS ultimo\nFROM correos_salida\nGROUP BY tipo\nORDER BY correos DESC'],
  ['Sesiones abiertas',
    "SELECT email, datetime(ultima / 1000, 'unixepoch') AS ultima_actividad_utc\nFROM sesiones\nORDER BY ultima DESC"]
];

const CLAVE = 'vx-datos-consola';

function leerGuardada(): string {
  try { return sessionStorage.getItem(CLAVE) || EJEMPLOS[0][1]; } catch { return EJEMPLOS[0][1]; }
}

export function Consola({ email, alFallar }: { email: string; alFallar: (e: unknown) => void }) {
  const [sql, setSql] = useState(leerGuardada);
  const [res, setRes] = useState<RespConsulta | null>(null);
  const [error, setError] = useState('');
  const [viaje, setViaje] = useState<Viaje | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  const ejecutar = async () => {
    if (corriendo) return;
    setCorriendo(true);
    setError('');
    try { sessionStorage.setItem(CLAVE, sql); } catch { /* sin almacenamiento */ }
    try {
      const { r, viaje } = await llamar<RespConsulta>('datosConsulta', [email, sql]);
      setViaje(viaje);
      if (esFallo(r)) { setError(r.message); setRes(null); }
      else setRes(r);
    } catch (e) {
      alFallar(e);
      setError(String((e as Error)?.message || e));
    } finally {
      setCorriendo(false);
    }
  };

  return (
    <div className="vista vista-consola">
      <section className="tarjeta" aria-labelledby="titulo-consola">
        <header className="consola-cab">
          <div>
            <h1 id="titulo-consola">Consola de solo lectura</h1>
            <p>Pregúntale a la base lo que quieras con SQL. Contesta D1 desde Cloudflare, en milisegundos.</p>
          </div>
          <div className="reglas" aria-label="Reglas">
            <span className="chip chip-ok">Solo SELECT o WITH</span>
            <span className="chip">Una sentencia</span>
            <span className="chip">Hasta 200 filas</span>
            <span className="chip"><Icono n="candado" />Sin secretos</span>
          </div>
        </header>
        <div className="editor">
          <label className="sr" htmlFor="sql">Consulta SQL</label>
          <textarea id="sql" ref={area} value={sql} spellCheck={false} autoCapitalize="off" autoCorrect="off"
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void ejecutar(); } }}
            aria-describedby="sql-ayuda" />
        </div>
        <div className="editor-acciones">
          <button type="button" className="btn btn-primario" onClick={() => void ejecutar()} disabled={corriendo || !sql.trim()}>
            <Icono n="jugar" />{corriendo ? 'Consultando…' : 'Ejecutar'} <kbd aria-hidden="true">Ctrl ↵</kbd>
          </button>
          <span id="sql-ayuda" className="sr">Ctrl más Enter ejecuta la consulta.</span>
          <div className="ejemplos">
            <span>Ejemplos:</span>
            {EJEMPLOS.map(([t, q]) => (
              <button key={t} type="button" className="ejemplo" onClick={() => { setSql(q); area.current?.focus(); }}>{t}</button>
            ))}
          </div>
        </div>
        {(res || error) ? (
          <div className="resultado" aria-live="polite">
            <div className="resultado-cab">
              <h2>{error ? 'No se ejecutó' : numero(res!.filas.length) + (res!.filas.length === 1 ? ' fila' : ' filas') + (res!.truncado ? ' (hay más: el tope es ' + res!.limite + ')' : '')}</h2>
              {res && !error ? <Medidor d1={res.d1} viaje={viaje} filas /> : null}
            </div>
            {error ? (
              <div className="aviso aviso-error" role="alert"><Icono n="alerta" /><span>{error}</span></div>
            ) : res && res.filas.length ? (
              <div className="rejilla-envoltura">
                <Rejilla etiqueta="Resultado de la consulta" columnas={res.columnas.map((c) => ({ nombre: c }))}
                  filas={res.filas.map((f, i) => ({ clave: String(i), celdas: f }))} desde={1} />
              </div>
            ) : (
              <div className="aviso aviso-info" style={{ margin: '0 1.15rem 1.1rem' }}><Icono n="info" />La consulta no devolvió filas.</div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
