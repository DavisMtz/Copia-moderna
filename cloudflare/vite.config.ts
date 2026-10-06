/*
 * Islas React del Portal en Cloudflare (src/react) → public/vx/app
 * ================================================================
 *   panel  → /vx/app/panel.js   NOMBRE FIJO: scripts/construir.mjs lo inyecta al final de <body> en las
 *            20 pantallas. Es solo el arranque (~2 KB): React y el panel abierto llegan en un trozo
 *            aparte (assets/abierto-*.js) cuando alguien lo abre.
 *   datos  → /vx/app/datos.html  el explorador de la base (?page=datos lo sirve el Worker).
 * Lo de assets/ lleva el hash de su contenido en el nombre y se guarda un año (public/_headers).
 *
 *   npm run construir   (vite build y luego las pantallas, que necesitan que panel.js ya exista)
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('./src/react/', import.meta.url));

export default defineConfig({
  root: raiz,
  base: '/vx/app/',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./public/vx/app/', import.meta.url)),
    emptyOutDir: true,
    // Lo mismo que las pantallas (scripts/construir.mjs compila para chrome109).
    target: ['chrome109', 'edge109', 'firefox115', 'safari16'],
    // Al abrir el panel, React y el panel se piden A LA VEZ (modulepreload) y no uno tras otro. Los
    // navegadores de la lista ya lo conocen: el polyfill sería peso muerto en las 20 pantallas.
    modulePreload: { polyfill: false },
    reportCompressedSize: true,
    chunkSizeWarningLimit: 400,
    rolldownOptions: {
      input: {
        panel: raiz + 'panel/main.ts',
        datos: raiz + 'datos.html'
      },
      output: {
        entryFileNames: (trozo) => (trozo.name === 'panel' ? 'panel.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        // React en su propio trozo, compartido por el panel abierto y el explorador (se baja una vez).
        codeSplitting: {
          groups: [{ name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ }]
        }
      }
    }
  }
});
