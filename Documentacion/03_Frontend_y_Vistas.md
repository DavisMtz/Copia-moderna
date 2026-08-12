# Frontend — Documentación Total y Exhaustiva de los 40 Archivos HTML

> **DOCUMENTACIÓN TÉCNICA Y DIDÁCTICA DE ARQUITECTURA Y MANTENIMIENTO**
> **Sistema Integral Portal Ventel & Extensión Chrome**
> **Autor:** David Martínez (`dmartineza02@liverpool.com.mx`)

---

## 🎨 Cobertura Total de la Capa de Presentación (40 Archivos HTML)

Este documento detalla la responsabilidad técnica, estructura e integración de los **40 archivos HTML** (vistas principales, parciales, componentes e infraestructura) del proyecto.

---

### 🧱 1. Archivos de Infraestructura y Componentes Reutilizables (`app_*.html`)

| Archivo | Tipo | Descripción y Lógica Interna |
| :--- | :--- | :--- |
| `app_core.html` | Infraestructura | Núcleo JS. Define `AppSession` (sesión), `AppUrl` (enrutador con enlace de rescate `NavAviso`), `AppCache` (almacenamiento local), `AppBusy` (indicador de carga) y `AppRun.swr` (patrón Stale-While-Revalidate). |
| `app_shell.html` | Layout Maestro | Contenedor de la aplicación (`AppShell.mount()`). Genera la barra superior, el menú lateral colapsable, el selector de áreas y el menú de preferencias visuales. |
| `app_theme.html` | Sistema de Diseño | Define tokens CSS y 3 temas (`aurora`, `slate`, `carbon`), tipografías (`Inter`, `JetBrains Mono`) y clases base de UI (botones, badges, tarjetas, modales, tablas). |
| `app_auth.html` | Componente Auth | Secuencias de animación GSAP para login/registro, trazo del logotipo de Liverpool (DrawSVG), medidor de fuerza de contraseña y widget OTP de 6 celdas (`AuthOtp`). |
| `app_buscar.html` | Motor de Búsqueda | Normalización de cadenas, desensamblado de acentos NFD, tokenización y resaltado HTML con etiquetas `<mark>`. Incluye caché de memoización de 2 generaciones. |
| `app_comando.html` | Paleta de Comandos | Modal accesible vía `Ctrl+K` o `/`. Transforma su geometría desde el botón detonador mediante técnica GSAP FLIP con contra-escala inversa. |
| `app_operacion.html` | Isla Dinámica | Botón flotante inferior (`.op-pill`) con morfeo SVG (GSAP MorphSVGPlugin), panel lateral de incidentes y prompt de rescate para `AppAtenciones`. |
| `app_icons.html` | Repositorio SVG | Catálogo centralizado de iconos vectoriales SVG para todos los botones y estados del sistema. |
| `app_motion.html` | Animaciones | Funciones de animación e interacción visual (efectos de sacudida `shake`, resplandor `glow` y transiciones de pantalla). |
| `app_onboarding.html` | Tour Guiado | Overlay interactivo para recorridos guiados paso a paso (`AppOnboarding`) sincronizado con la hoja `Onboarding`. |
| `app_guardado.html` | Autoguardado | Gestor de persistencia en segundo plano para borradores de cotizaciones en `localStorage`. |
| `app_atenciones.html` | Componente | Panel lateral superpuesto para gestión rápida de atenciones pospuestas sin salir de la vista actual. |
| `app_prefs.html` | Preferencias | Lógica de conmutación de temas, densidad compacta, escala de texto y alto contraste. |
| `app_tailwind.html` | Estilos Tailwind | Capa de utilidades CSS de Tailwind con shims de compatibilidad para el tema oscuro `carbon`. |
| `app_estado_historial.html` | Componente | Vista gráfica del historial por horas y días del estado operativo de los sistemas. |
| `app_estatus.html` | Componente | Formateadores y badges de estado para las cotizaciones (`En Revisión`, `Aprobada`, `Rechazada`). |
| `app_extension_guia.html` | Modal Guía | Modal instructivo con pasos para instalar y utilizar la Extensión de Chrome. |
| `app_ccl.html` | Modal CCL | Modal de vista previa e inyección del formato de impresión CCL Liverpool. |
| `app_support.html` | Modal Soporte | Ventana emergente con información de contacto y soporte técnico del equipo Ventel. |

---

### 🖼️ 2. Vistas Principales de la Aplicación

| Archivo | Ruta (`?page=`) | Descripción y Lógica |
| :--- | :--- | :--- |
| `Index.html` | `portal` | Landing page principal. Muestra las herramientas, paqueterías, plantillas, anuncios y puente de búsqueda hacia cotizaciones. |
| `Promociones.html` | `promociones` | Monitor de promociones comerciales, ofertas Marketplace y eventos de Google Calendar a 90 días. |
| `estado.html` | `estado` | Tablero público de estado de los sistemas (Connect, Página/App, Salesforce, CCAIP) accesible sin sesión. |
| `inicio.html` | `dashboard` | Dashboard del asesor. Muestra resumen de cotizaciones propias, accesos rápidos y atenciones pendientes. |
| `inicio_avanzado.html` | `inicio_avanzado` | Dashboard de supervisión. Muestra gráficas de rendimiento, métricas mensuales y ranking de asesores. |
| `cotizacion.html` | `cotizacion` | Pantalla principal de creación y edición de cotizaciones. Integrada con la Extensión de Chrome. |
| `cotizado_preview.html` | `cotizado_preview` | Vista previa del documento generado antes de su aprobación o envío. |
| `consulta_cotizacion.html` | `consulta_cotizacion` | Buscador y vista detallada de cotizaciones registradas. |
| `revision_cotizacion.html` | `revision_cotizacion` | Pantalla de auditoría para supervisores. Muestra la ficha raspada en vivo en un iframe purgado `srcdoc` y los 8 puntos de auditoría. |
| `consola.html` | `consola` | Consola Maestra de Administración. Pestañas de Miembros, Módulos, Ajustes, Formatos, Salud y Bitácora. |
| `operacion.html` | `operacion` | Panel de supervisión de incidentes operativos. Permite confirmar, descartar o actualizar fallas. |
| `atenciones.html` | `atenciones` | Tablero de gestión de clientes en atención pospuesta con reserva de 15 minutos y pool público. |
| `portal_contenido.html` | `portal_contenido` | Editor de contenido del portal. Gestión celda por celda e importación masiva para 9 colecciones. |
| `anuncios.html` | `anuncios` | Constructor y administrador de anuncios, banners y modales promocionales. |
| `correo_cliente.html` | `correo_cliente` | Editor de correos a clientes con plantillas HTML responsivas y carga de adjuntos. |
| `correoventel.html` | `correoventel` | Pantalla de envío de cotizaciones por correo al cliente final. |
| `inicioDeSesion.html` | `login` | Pantalla de inicio de sesión. |
| `registro.html` | `registro` | Pantalla de registro de nuevos usuarios con verificación por código OTP. |
| `recuperar.html` | `recuperar` | Pantalla de recuperación de contraseña en 3 pasos (solicitud, OTP, clave nueva). |
| `LoaderPartial.html` | Parcial | Pantalla de carga inicial con spinner corporativo. |
| `ViewPrefsPartial.html` | Parcial | Fragmento de interfaz para el panel de ajustes visuales. |

---

## ✍️ Firma de Responsabilidad Técnica

**David Martínez**  
*Escritor y Arquitecto Principal del Sistema*  
Correo Institucional: `dmartineza02@liverpool.com.mx`  
El Puerto de Liverpool · Equipo Ventel  
*Agosto de 2026*
