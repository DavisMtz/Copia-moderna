-- Ajustes de la maqueta en PRODUCCIÓN. En local no se aplican: scripts/dev-aislado.sh salta los
-- archivos *produccion*, así que las pruebas siguen viendo el candado de dominio del original.
-- scripts/desplegar.sh --semillas los aplica después de los datos de ejemplo.

-- Registro abierto a cualquier dominio (decisión del 07/10/2026). El correo de esas cuentas tiene
-- su propia regla en nucleo/correo.ts: si le escriben a terceros, el correo les llega a ellas.
INSERT INTO propiedades (clave, valor, actualizado) VALUES ('CUENTAS_DOMINIO', 'ninguno', '2026-10-07T00:00:00.000Z')
  ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado = excluded.actualizado;
