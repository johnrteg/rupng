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
            alias : { "@shared": resolve( __dirname, "src/shared" ) }
        },
        build:
        {
            rollupOptions : { input: resolve( __dirname, "src/renderer/index.html" ) }
        }
    }
} );
