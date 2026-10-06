/*
 * Las cifras de Apps Script contra las que se compara el panel. SOLO cifras MEDIDAS y escritas en el
 * repo (PRODUCT.md: «No se inventan cifras»), cada una con su fuente, que el panel cita. Donde había
 * varias, se eligió la que MÁS favorece a Apps Script: la comparación tiene que aguantar a quien la
 * revise con la documentación en la mano.
 */

export interface Fuente {
  /** Número de la nota al pie en el panel. */
  n: number;
  texto: string;
  archivo: string;
}

export interface CifraGas {
  /** Como lo escribe la fuente (es lo que se enseña). */
  texto: string;
  /** El mismo valor en ms, para la barra (si la fuente da un rango, su extremo BAJO). */
  ms: number;
  nota: number;
}

export const FUENTES: Fuente[] = [
  {
    n: 1,
    texto: 'Medido el 23/09/2026: mediana de 21 llamadas vacías con el código del Portal en producción (/exec), ' +
      'y de 14 a un proyecto vacío, el piso de Google. Code.gs lo resume: «1.5-2.3 s cada una».',
    archivo: 'Documentacion/15_Entorno_Apps_Script_Hallazgos_y_Plan.md §3.2'
  },
  {
    n: 2,
    texto: '24/09/2026, Fase 3a: mediana de 30 cargas del Portal en pruebas, ya con las mejoras. ' +
      'En producción se midieron 3.2-4.0 s (doc 15 §2).',
    archivo: 'Documentacion/13_Plan_Cierre_v1.md'
  },
  {
    n: 3,
    texto: '23/09/2026: DOMContentLoaded del Portal en pruebas (/dev). En producción, 4.5 s.',
    archivo: 'Documentacion/15_Entorno_Apps_Script_Hallazgos_y_Plan.md §2'
  },
  {
    n: 4,
    texto: '24/09/2026, Fase 3a: el último dato del Portal llegaba entre los 5.8 y los 8.0 s (antes, a los ≈13 s).',
    archivo: 'Documentacion/13_Plan_Cierre_v1.md · doc 15 §2'
  }
];

export const GAS = {
  /** Una llamada google.script.run con el código del Portal. */
  llamada: { texto: '1,994 ms', ms: 1994, nota: 1 } as CifraGas,
  /** Una llamada a un proyecto de Apps Script VACÍO: lo menos que puede tardar, haga lo que haga el código. */
  piso: { texto: '773 ms', ms: 773, nota: 1 } as CifraGas,
  primerByte: { texto: '2.70 s', ms: 2700, nota: 2 } as CifraGas,
  pantallaLista: { texto: '3.6 s', ms: 3600, nota: 3 } as CifraGas,
  ultimoDato: { texto: '5.8–8.0 s', ms: 5800, nota: 4 } as CifraGas
};

/** Siglas de los puntos de Cloudflare que más pueden salir desde México. */
export const CIUDADES: Record<string, string> = {
  MEX: 'Ciudad de México', QRO: 'Querétaro', GDL: 'Guadalajara', MTY: 'Monterrey',
  DFW: 'Dallas', IAH: 'Houston', AUS: 'Austin', SAT: 'San Antonio', LAX: 'Los Ángeles', SAN: 'San Diego',
  SJC: 'San José (California)', SFO: 'San Francisco', SEA: 'Seattle', PDX: 'Portland', PHX: 'Phoenix',
  LAS: 'Las Vegas', DEN: 'Denver', SLC: 'Salt Lake City', MCI: 'Kansas City', MSP: 'Mineápolis',
  ORD: 'Chicago', ATL: 'Atlanta', MIA: 'Miami', IAD: 'Washington', EWR: 'Newark', JFK: 'Nueva York',
  BOS: 'Boston', YYZ: 'Toronto', BOG: 'Bogotá', LIM: 'Lima', SCL: 'Santiago de Chile', GRU: 'São Paulo',
  MAD: 'Madrid', LHR: 'Londres', FRA: 'Fráncfort', AMS: 'Ámsterdam'
};
