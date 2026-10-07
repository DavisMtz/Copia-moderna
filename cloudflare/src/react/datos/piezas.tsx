/* Piezas compartidas del explorador: iconos, el medidor de D1, las celdas y la rejilla. */
import type { ReactNode } from 'react';
import type { Celda, MedidaD1, Viaje } from './api';
import { numero, tiempo } from '../compartido/formato';

const TRAZOS: Record<string, ReactNode> = {
  tabla: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></>,
  consola: <path d="M4 17l6-5-6-5M12 19h8" />,
  correo: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  buscar: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  candado: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  izq: <path d="M15 18l-6-6 6-6" />,
  der: <path d="M9 18l6-6-6-6" />,
  cerrar: <path d="M18 6L6 18M6 6l12 12" />,
  clip: <path d="M21 12.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l9-9a3.3 3.3 0 0 1 4.7 4.7l-9 9a1.7 1.7 0 0 1-2.4-2.4l8.3-8.3" />,
  base: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
  volver: <path d="M19 12H5M12 19l-7-7 7-7" />,
  rayo: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  arriba: <path d="M12 19V5M5 12l7-7 7 7" />,
  abajo: <path d="M12 5v14M19 12l-7 7-7-7" />,
  ordenar: <path d="M8 9l4-4 4 4M16 15l-4 4-4-4" />,
  jugar: <path d="M7 4.5v15l12-7.5z" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  alerta: <><path d="M12 3.5l9 16H3z" /><path d="M12 10v4M12 17h.01" /></>,
  escudo: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  reloj: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>
};

export function Icono({ n, titulo }: { n: keyof typeof TRAZOS | string; titulo?: string }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden={titulo ? undefined : true} role={titulo ? 'img' : undefined}>
      {titulo ? <title>{titulo}</title> : null}
      {TRAZOS[n] || null}
    </svg>
  );
}

/** Lo que costó una consulta: D1 medido en el Worker, lo que tardó la base y el viaje completo. */
export function Medidor({ d1, viaje, filas }: { d1?: MedidaD1 | null; viaje?: Viaje | null; filas?: boolean }) {
  if (!d1) return null;
  const titulo = 'D1: ' + tiempo(d1.ms) + ' entre el Worker y la base (' + d1.consultas + ' ' + (d1.consultas === 1 ? 'viaje' : 'viajes') +
    '), ' + tiempo(d1.sql) + ' ejecutando SQL. ' + (viaje ? 'Ida y vuelta desde tu navegador: ' + tiempo(viaje.ida) + '.' : '');
  return (
    <span className="medidor" title={titulo}>
      <Icono n="rayo" />
      <span>D1 <b>{tiempo(d1.ms)}</b></span>
      {filas && d1.filasLeidas ? <><i /><span>{numero(d1.filasLeidas)} filas leídas</span></> : null}
      {viaje ? <><i /><span>ida y vuelta <b>{tiempo(viaje.ida)}</b></span></> : null}
    </span>
  );
}

const ES_FECHA = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function textoDeCelda(v: Celda): string {
  if (v === null) return 'NULL';
  if (typeof v === 'number' || typeof v === 'string') return String(v);
  if ('$oculto' in v) return 'oculto';
  if ('$cortado' in v) return v.$cortado;
  return 'BLOB · ' + v.$blob + ' bytes';
}

export function ValorCelda({ v }: { v: Celda }) {
  if (v === null) return <span className="v-nulo">NULL</span>;
  if (typeof v === 'number') return <>{String(v)}</>;
  if (typeof v === 'string') {
    if (ES_FECHA.test(v)) return <span className="v-fecha">{v}</span>;
    if (/^[[{]/.test(v)) return <span className="v-json">{v}</span>;
    return <>{v}</>;
  }
  if ('$oculto' in v) return <span className="v-oculto" title="Secreto: no sale de la base"><Icono n="candado" />oculto</span>;
  if ('$cortado' in v) {
    return (
      <>
        <span className={/^[[{]/.test(v.$cortado) ? 'v-json' : ''}>{v.$cortado}</span>
        <span className="v-cortado">… {numero(v.largo)} caracteres</span>
      </>
    );
  }
  return <span className="v-blob">BLOB · {numero(v.$blob)} bytes</span>;
}

export interface ColRejilla { nombre: string; tipo?: string; oculta?: string; ordenable?: boolean; pk?: number }

export function Rejilla({ columnas, filas, orden, dir, alOrdenar, alElegir, elegida, desde, etiqueta }: {
  columnas: ColRejilla[];
  filas: Array<{ clave: string; celdas: Celda[] }>;
  orden?: string; dir?: 'asc' | 'desc';
  alOrdenar?: (col: string) => void;
  alElegir?: (clave: string) => void;
  elegida?: string;
  desde?: number;
  etiqueta: string;
}) {
  return (
    <table className="rejilla" aria-label={etiqueta}>
      <thead>
        <tr>
          {desde !== undefined ? <th scope="col"><span className="col"><span className="sr">Fila</span></span></th> : null}
          {columnas.map((c, i) => {
            const activa = orden === c.nombre;
            const sort = activa ? (dir === 'desc' ? 'descending' : 'ascending') : undefined;
            const contenido = (
              <>
                <span className="col-n">{c.nombre}</span>
                {c.tipo ? <span className="col-t">{c.tipo}</span> : null}
                {c.oculta ? <Icono n="candado" titulo={c.oculta === 'siempre' ? 'Secreto: siempre oculta' : 'Oculta cuando la clave parece secreta'} /> : null}
                {alOrdenar && c.ordenable ? <Icono n={activa ? (dir === 'desc' ? 'abajo' : 'arriba') : 'ordenar'} /> : null}
              </>
            );
            return (
              <th key={c.nombre + ':' + i} scope="col" aria-sort={sort} className={c.pk ? 'col-llave' : undefined}>
                {alOrdenar && c.ordenable ? (
                  <button type="button" className="col" onClick={() => alOrdenar(c.nombre)}
                    title={'Ordenar por ' + c.nombre}>{contenido}</button>
                ) : <span className="col">{contenido}</span>}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {filas.map((f, i) => (
          <tr key={f.clave} className={alElegir ? 'clic' : undefined} tabIndex={alElegir ? 0 : undefined}
            aria-selected={alElegir ? elegida === f.clave : undefined}
            onClick={alElegir ? () => alElegir(f.clave) : undefined}
            onKeyDown={alElegir ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alElegir(f.clave); } } : undefined}>
            {desde !== undefined ? <td className="n-fila">{desde + i}</td> : null}
            {f.celdas.map((v, j) => (
              <td key={j} className={typeof v === 'number' ? 'num' : undefined} title={typeof v === 'object' && v !== null ? undefined : textoDeCelda(v).slice(0, 400)}>
                <ValorCelda v={v} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Huesos({ columnas, filas }: { columnas: number; filas: number }) {
  return (
    <table className="rejilla" aria-hidden="true">
      <tbody>
        {Array.from({ length: filas }, (_, i) => (
          <tr key={i}>{Array.from({ length: Math.max(1, columnas) }, (_, j) => (
            <td key={j}><span className="hueso" style={{ width: 40 + ((i * 7 + j * 13) % 50) + '%' }} /></td>
          ))}</tr>
        ))}
      </tbody>
    </table>
  );
}

/** «1–50 de 1,234». */
export function rango(pagina: number, porPagina: number, total: number): string {
  if (!total) return 'Sin filas';
  const a = (pagina - 1) * porPagina + 1;
  const b = Math.min(total, pagina * porPagina);
  return numero(a) + '–' + numero(b) + ' de ' + numero(total);
}
