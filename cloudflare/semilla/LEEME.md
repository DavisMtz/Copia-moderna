# Semillas de la base D1

`scripts/dev-aislado.sh` aplica en orden todos los `semilla/*.sql` a una base local nueva.

| Archivo | Qué es | ¿En git? |
| --- | --- | --- |
| `00_usuarios_demo.sql` | Cuentas ficticias de la demo (contraseña `VentelDemo2026`) | Sí |
| `portal_ventel.json` | Catálogo REAL de la hoja «Portal Ventel» (herramientas, paqueterías, formatos, planes de pago, plantillas, promociones, MKP, anuncios), sin contraseñas ni datos de clientes | **No**: el repo es público |
| `*.local.sql` | Todo lo que se genera a partir del catálogo real | **No** |

Para regenerar `portal_ventel.json` hace falta acceso a la hoja en Google Drive (exportarla como XLSX y
convertirla sin las columnas «Como acceder» y «Claves»).
