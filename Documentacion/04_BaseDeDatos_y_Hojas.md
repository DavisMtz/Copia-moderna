# Base de Datos — Manual Explicativo de Tablas e Integridad

> **DOCUMENTACIÓN TÉCNICA Y DIDÁCTICA DE ARQUITECTURA Y MANTENIMIENTO**
> **Sistema Integral Portal Ventel & Extensión Chrome**
> **Autor:** David Martínez (`dmartineza02@liverpool.com.mx`)

---

## 🗄️ Filosofía de Diseño: Google Sheets como Base de Datos Relacional

Usar Google Sheets como base de datos de un sistema empresarial presenta desafíos únicos. A diferencia de una base de datos SQL tradicional (donde las columnas están fijadas por esquemas estrictos), en Google Sheets un usuario con permisos de edición podría mover una columna, cambiarle el nombre o insertar filas manualmente.

Para evitar que estos eventos corrompan la información, el backend del Portal Ventel implementa **tres mecanismos de resistencia de datos**.

---

## 🛡️ Mecanismos de Resistencia e Integridad

---

### 1. Acceso Dinámico por Nombre de Encabezado (No por Posición)
- **El Problema en Código Frágil:**
  Muchos scripts de Apps Script escriben datos por posición fija: `hoja.getRange(fila, 3).setValue(cliente)`. Si alguien inserta una columna nueva antes de la columna 3, el nombre del cliente se escribirá en la columna equivocada.
- **La Solución en Portal Ventel:**
  El backend lee siempre la primera fila de la hoja (los encabezados), construye un índice dinámico en memoria y busca la posición exacta del nombre del campo:
  ```javascript
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const clienteIdx = headers.indexOf("ClienteNombre");
  // clienteIdx devuelve la posición real de "ClienteNombre" sin importar dónde esté ubicada
  filaData[clienteIdx] = quoteData.clientName;
  ```

---

### 2. Columnas Auto-Reparables (Auto-Healing Schema)
- **¿Cómo funciona?**
  Cuando se despliega una nueva actualización de software que requiere guardar un dato adicional (ejemplo: guardar la URL de la ficha del producto `LinkArticulo`), no es necesario que el desarrollador edite manualmente la hoja de cálculo en producción.
  Al momento de guardar la primera cotización con el nuevo campo:
  1. El backend busca el encabezado `LinkArticulo`.
  2. Si no lo encuentra (`indexOf === -1`), inserta automáticamente la palabra `"LinkArticulo"` al final de la primera fila.
  3. Actualiza el índice en tiempo de ejecución y guarda el dato en la nueva columna.

---

### 3. Preservación Intacta de Fórmulas (`getFormulas()`)
- **El Problema:**
  Si un administrador agrega una fórmula personalizada en la hoja `Cotizaciones` (ejemplo: una fórmula `=SUMA(...)` o `=SI(...)` para calcular comisiones), y luego el sistema actualiza el estado de esa cotización sobrescribiendo la fila completa con `setValues()`, la fórmula personalizada se perdería y se convertiría en un valor de texto estático.
- **La Solución:**
  Al actualizar una fila existente, `saveQuoteDataToSheets` ejecuta primero `.getFormulas()` sobre la fila. Si detecta que alguna celda contiene una fórmula iniciada con `=`, conserva la fórmula original en el arreglo de escritura en lugar de sobrescribirla con el valor calculado.

---

## 📋 Diccionario Detallado de Tablas Principales

### 1. `Registros` (Tabla de Usuarios)
- **Email (Llave Primaria):** Correo institucional del asesor. Base para la autenticación y permisos.
- **PasswordHash:** Digest SHA-256 de la contraseña + `HASH_SALT`.
- **Avanzado:** Boolean que define si el usuario pertenece al grupo de supervisión.
- **PasswordTemporal:** Marca auto-reparable (`Si`/`No`) que obliga al usuario a cambiar su contraseña en el siguiente inicio de sesión.

### 2. `Cotizaciones` (Cabeceras de Cotización)
- **Folio (Llave Primaria):** Identificador `LVP-YYMMDD-XXXX`.
- **AsesorCorreo / AsesorNombre / Extencion:** Identidad del vendedor que realizó la cotización.
- **ClienteNombre / CorreoCliente / Numero:** Datos de contacto del cliente cotizado.
- **Subtotal / IVA / TotalGeneral:** Importes económicos en Pesos MXN (IVA fijado al 16%).
- **Estatus:** Estado dentro del flujo de trabajo (`Folio Generado`, `En Revisión`, `Aprobada`, `Rechazada`, `Enviada por Correo`).
- **LinkPDF:** Enlace directo al documento PDF exportado en Google Drive.
- **Formato:** ID del formato de diseño aplicado (`actual`, `ccl_liverpool`).
- **RevisionEstado / RevisadoPor / RevisionNotas:** Registro de auditoría del supervisor o motor de reglas automáticas.

### 3. `DetalleCotizaciones` (Partidas de Producto)
- **FolioCotizacion (Llave Foránea):** Vincula cada producto con la cabecera en `Cotizaciones.Folio`.
- **SKU:** Código de artículo o variante a 9 o 10 dígitos.
- **DescripcionProducto / Cantidad / PrecioUnitarioBase:** Datos base del producto.
- **DescPublicoPorcentaje / AplicaDescAdicional / PorcentajeDescAdicional:** Descuentos aplicados.
- **ImagenUrl:** Enlace a la imagen del producto en CDN Liverpool.
- **LinkArticulo:** Enlace directo a la ficha del producto en `liverpool.com.mx` extraído por la extensión de Chrome.

---

## ✍️ Firma de Responsabilidad Técnica

**David Martínez**  
*Escritor y Arquitecto Principal del Sistema*  
Correo Institucional: `dmartineza02@liverpool.com.mx`  
El Puerto de Liverpool · Equipo Ventel  
*Agosto de 2026*
