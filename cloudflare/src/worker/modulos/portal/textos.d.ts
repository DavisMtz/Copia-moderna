// Archivos .html importados como texto: wrangler los empaqueta así por omisión (regla «Text» para
// **/*.html). Los usa modulos/portal/recursos.ts para fp_logos, reco_imagenes y el sprite.
declare module '*.html' {
  const contenido: string;
  export default contenido;
}
