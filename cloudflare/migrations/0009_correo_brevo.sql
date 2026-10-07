-- Los correos salen de verdad por Brevo (dominio logidma.com): cada fila de la bandeja de salida
-- dice qué pasó con ella. estado: 'enviado' | 'omitido' | 'error'. proveedor_id: el messageId de Brevo.
ALTER TABLE correos_salida ADD COLUMN estado TEXT;
ALTER TABLE correos_salida ADD COLUMN proveedor_id TEXT;
ALTER TABLE correos_salida ADD COLUMN detalle TEXT;
CREATE INDEX IF NOT EXISTS correos_salida_estado ON correos_salida (estado, fecha);
