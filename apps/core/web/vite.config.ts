import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

//
// Vite config for the web SPA.
//   • Entry: index.html (package root) → /src/main/index.tsx  (the createRoot(...).render(<App/>) mount).
//   • resolve.tsconfigPaths honors the SAME @-aliases as tsconfig.json `paths` (single source of truth) —
//     Vite 8 native, so @widgets/core, @model, @utils, @repo/common, … resolve identically in dev, build,
//     tsc, and the editor (no separate alias list to keep in sync).
//   • Output → bin/ (what the dev-only webproxy serves: web.root = ../../web/bin).
//   • Static assets (/assets/banner, /assets/language, /assets/themes, favicon) live in ./public.
//
export default defineConfig({
    plugins: [ react() ],
    resolve: {
        tsconfigPaths: true,
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
                    return 'vendor';                                                          // everything else
                },
            },
        },
    },
    server: {
        port: 5173,
    },
});
