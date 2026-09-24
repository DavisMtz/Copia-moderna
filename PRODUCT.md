# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Asesores del equipo Ventel**: venta y atención telefónica de El Puerto de Liverpool. Casi siempre tienen un cliente en la línea mientras usan el Portal.
- **Coordinación y supervisión** (roles avanzado y maestro): publican anuncios y artículos, revisan cotizaciones y administran permisos.

## Product Purpose

Portal Ventel es el centro de operación del equipo: herramientas, paqueterías, formas y guías de pago, formatos, plantillas, trazabilidad, promociones y cotizaciones, a un clic y con buscador. El éxito es que el asesor encuentre y use lo que necesita sin soltar la llamada.

## Operating Context

- Webapp de Google Apps Script (HTML Service) dentro de la red de Liverpool, junto a Salesforce/CCAIP. Las hojas de Google Sheets son la base de datos, y mucha gente ajena al código edita el contenido desde ahí.
- Se usa sobre todo en escritorio. Hay tres temas (Aurora, Slate, Carbón), cuatro tamaños de texto, densidad compacta y alto contraste.
- Los sistemas de todos los días (Salesforce, CSC…) se abren con el buscador (Ctrl K); confirmado el 24/09/2026. Las secciones se recorren para explorar y entender: qué es cada cosa, cómo se entra y qué decirle al cliente.
- Una extensión de Chrome lleva la bolsa de liverpool.com.mx a una cotización nueva.
- Hay dos proyectos de Apps Script, producción y pruebas: todo cambio va primero a pruebas.

## Capabilities and Constraints

- El contenido sale de hojas. Herramientas trae Nombre | Enlace | Cómo acceder | Descripción | Claves. Hay más hojas: Paqueterías, Formatos, Presentaciones, Pago Web, Plantillas, Anuncios (publicaciones) y Artículos.
- Algunas filas de «Cómo acceder» llevan contraseñas compartidas: nunca se muestran sin una acción explícita de quien consulta.
- Los formatos de cotización son intocables.
- GSAP 3.13 desde cdnjs. Ninguna pantalla depende de una animación para verse; las reglas están en `.claude/skills/gsap-ventel`.

## Brand Commitments

- Rosa Liverpool `#E10098` como acento, no como superficie de contenido.
- La portada «Tu turno» (`Index.html`, `sec-inicio`, 23/09/2026) es la referencia visual aprobada para el resto del Portal.
- Voz: español de México, tuteo, frases cortas y concretas. Los nombres de los sistemas se escriben como los escribe el equipo.

## Evidence on Hand

- Datos reales en las hojas del Portal: 46 herramientas al 24/09/2026 (19 con descripción, 12 con «cómo acceder», 2 con clave).
- No hay mediciones de uso ni de satisfacción. No se inventan cifras ni afirmaciones sobre el uso del producto.

## Product Principles

1. En llamada, la rapidez gana al adorno.
2. Lo personal y lo vivo pesan, como en la portada.
3. Nada depende de una animación para verse.
4. Todo va primero a pruebas.

## Accessibility & Inclusion

- Cuatro tamaños de texto, alto contraste y movimiento reducido respetado siempre.
- Navegación por teclado: Ctrl K o `/` para buscar, `g` + tecla para ir a una sección.
