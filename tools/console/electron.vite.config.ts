import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

//
// electron-vite builds three targets from one config: main (Node/Electron), preload (bridge),
// and renderer (the React/MUI UI via Vite). externalizeDepsPlugin keeps node_modules out of the
// main/preload bundles (they run in Node and can require() directly).
//
export default defineConfig( {
    main:
    {
        plugins : [ externalizeDepsPlugin() ],
        build   :
        {
            rollupOptions : { input: resolve( __dirname, "src/main/index.ts" ) }
        }
    },
    preload:
    {
        plugins : [ externalizeDepsPlugin() ],
        build   :
        {
            rollupOptions : { input: resolve( __dirname, "src/preload/index.ts" ) }
        }
    },
    renderer:
    {
        root    : resolve( __dirname, "src/renderer" ),
        plugins : [ react() ],
        resolve :
        {
            // React is installed both at the repo root (pulled in by the hoisted CodeMirror packages) and
            // in tools/console — two physical copies → "Invalid hook call / more than one copy of React".
            // dedupe forces every `react`/`react-dom` import to a single instance.
            dedupe : [ "react", "react-dom" ],

            // Resolve @repo/* workspace packages to their SOURCE (ESM), the same way the web app does via
            // tsconfigPaths. Without this the renderer falls back to each package's CommonJS `bin/index.js`,
            // which Vite serves raw to the browser as ESM — and native ESM can't read CJS named exports
            // (e.g. `import { ConfigSchema } from "@repo/api"` → "does not provide an export named …").
            // The closure of @repo/api is api → common, endpoint, system (ajv/axios resolve normally).
            alias :
            {
                "@shared"        : resolve( __dirname, "src/shared" ),
                "@repo/api"      : resolve( __dirname, "../../packages/api/src/index.ts" ),
                "@repo/endpoint" : resolve( __dirname, "../../packages/endpoint/src/index.ts" ),
                "@repo/common"   : resolve( __dirname, "../../packages/common/src/index.ts" ),
                "@repo/system"   : resolve( __dirname, "../../packages/system/src/index.ts" ),
            }
        },
        build:
        {
            rollupOptions : { input: resolve( __dirname, "src/renderer/index.html" ) }
        }
    }
} );
