import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

//
// Dev API target (LocalStack / local servers by default). Override per environment, e.g.
//   VITE_API_TARGET=https://dev.api.rumbleup.com npm run web
// Mirrors the webproxy `local` upstream so `npm run web` (Vite dev, HMR) reaches the same backend.
//
const API_TARGET : string = process.env.VITE_API_TARGET ?? 'http://localhost:8000';

// the backend API namespace (kept in sync with webproxy src/config/local.json `prefixes`). Everything
// under /api/{service}/v{N}/… is proxied to the backend; the SPA owns every other route.
const API_PREFIXES : Array<string> = [ '/api' ];

// build the dev proxy table: WS first (more specific than /account), then the REST prefixes
const proxy : Record<string, { target: string; ws?: boolean; changeOrigin?: boolean }> = {
    // WebSocket — `ws: true` performs the HTTP→WS upgrade; http→ws / https→wss
    '/account/ws': { target: API_TARGET.replace( /^http/, 'ws' ), ws: true },
};
for( const prefix of API_PREFIXES ) proxy[ prefix ] = { target: API_TARGET, changeOrigin: true };

//
// Vite config for the web SPA.
//   • Entry: index.html (package root) → /src/main/index.tsx  (the createRoot(...).render(<App/>) mount).
//   • resolve.tsconfigPaths honors the SAME @-aliases as tsconfig.json `paths` (single source of truth) —
//     Vite 8 native, so @widgets/core, @model, @utils, @repo/common, … resolve identically in dev, build,
//     tsc, and the editor (no separate alias list to keep in sync).
//   • server.proxy forwards the API prefixes + the /account/ws socket to the backend, so `npm run web`
//     (HMR) reaches REST + WebSockets in ONE process — no separate webproxy needed for dev.
//   • Output → bin/ (what the dev-only webproxy serves: web.root = ../../web/bin).
//   • Static assets (/assets/banner, /assets/language, /assets/themes, favicon) live in ./public.
//
export default defineConfig({
    plugins: [ react() ],
    resolve: {
        tsconfigPaths: true,
    },
    server: {
        port: 5173,
        proxy,
    },
    build: {
        outDir:      'bin',
        emptyOutDir: true,
        sourcemap:   true,
        rollupOptions: {
            output: {
                //
                // Code splitting — keep the big, slow-changing libraries in their OWN chunks so the
                // browser caches them across deploys (your app code changes every release; React/MUI don't).
                // Routes are ALREADY split per-page via React.lazy(() => import(...)) in AppRouter — those
                // become their own on-demand chunks automatically; this only governs the vendor (node_modules)
                // split. Don't over-split: a few stable groups beats dozens of tiny chunks.
                //
                manualChunks( id : string ) : string | undefined
                {
                    if( !id.includes( 'node_modules' ) ) return undefined;   // app code → default (route) chunks
                    if( id.includes( '@mui' ) || id.includes( '@emotion' ) )                 return 'mui';
                    if( id.includes( 'codemirror' ) )                                        return 'editor';   // heavy; only loaded where used
                    if( id.includes( 'emoji-picker-react' ) )                                return 'emoji';
                    if( id.includes( 'react' ) || id.includes( 'scheduler' ) )               return 'react';
                    // PDF stack (html2pdf + jsPDF + html2canvas) — keep OUT of vendor so it stays an
                    // on-demand chunk loaded only when a user downloads a PDF (it's ~1MB).
                    if( id.includes( 'html2pdf' ) || id.includes( 'jspdf' ) || id.includes( 'html2canvas' ) ) return undefined;
                    return 'vendor';                                                          // everything else
                },
            },
        },
    },
});
