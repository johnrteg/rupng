import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";

import { registerIpc } from "./ipc";
import { processManager } from "./processManager";
import { closeBrowser } from "./browser";
import { PROXY_DEFAULT_PORT } from "../shared/types";

//
// Main process entry. Creates the window, loads the renderer (dev server URL in `electron-vite dev`,
// built file otherwise), and wires the IPC surface. Local-only desktop tool — no SSL, no remote.
//

// Silence Electron's dev-only "Insecure Content-Security-Policy / unsafe-eval" warning. It fires
// because the dev renderer (vite HMR) uses unsafe-eval and the in-app browser loads pages with no
// CSP. This is a local developer tool — never packaged for end users — so the warning is just noise.
// (Real CSP hardening belongs on the web app itself, as a deliberate, tested production change.)
// Renderer processes inherit this env from main, so it covers the in-app browser window too.
process.env[ "ELECTRON_DISABLE_SECURITY_WARNINGS" ] = "true";

// This is a local dev tool. An uncaught error / rejection in MAIN should LOG (to the terminal) — never
// Electron's fatal "A JavaScript error occurred in the main process" modal, which on a detached process
// (PPID 1) can't be dismissed, leaving the app unkillable. Log + keep running instead of crashing.
process.on( "uncaughtException", ( err : Error ) => { console.error( "[main] uncaughtException:", err ); } );
process.on( "unhandledRejection", ( reason : unknown ) => { console.error( "[main] unhandledRejection:", reason ); } );

let mainWindow : BrowserWindow | null = null;

function createWindow() : void
{
    mainWindow = new BrowserWindow( {
        width           : 1480,
        height          : 920,
        minWidth        : 1080,
        minHeight       : 680,
        title           : "RumbleUp Console",
        backgroundColor : "#0e1116",
        show            : false,
        webPreferences  :
        {
            preload          : join( __dirname, "../preload/index.js" ),
            sandbox          : false,
            contextIsolation : true,
            nodeIntegration  : false
        }
    } );

    mainWindow.on( "ready-to-show", () => mainWindow?.show() );

    // the in-app browser is its own window — when the main console window closes, close it too
    mainWindow.on( "closed", () => { closeBrowser(); mainWindow = null; } );

    // open external links in the OS browser, never in-app
    mainWindow.webContents.setWindowOpenHandler( ( { url } ) =>
    {
        void shell.openExternal( url );
        return { action: "deny" };
    } );

    // electron-vite injects ELECTRON_RENDERER_URL in dev; load the built index.html otherwise
    const devUrl : string | undefined = process.env[ "ELECTRON_RENDERER_URL" ];
    if ( devUrl )
        void mainWindow.loadURL( devUrl );
    else
        void mainWindow.loadFile( join( __dirname, "../renderer/index.html" ) );
}

app.whenReady().then( () =>
{
    registerIpc( () => mainWindow );
    createWindow();

    // start the local edge (webproxy) on launch — it serves the SPA + proxies APIs to running
    // services. Uses the console's `.active` routing config if present, else the committed `local`.
    processManager.startProxy( PROXY_DEFAULT_PORT );

    app.on( "activate", () =>
    {
        if ( BrowserWindow.getAllWindows().length === 0 ) createWindow();
    } );
} );

// kill every spawned child (proxy, dev servers, …) on quit so nothing orphans — otherwise a leftover
// proxy keeps holding :9000 and the next launch's auto-start reports "address already in use".
app.on( "will-quit", () => processManager.shutdown() );

// quit when the last window closes — on every platform, including macOS (a single-purpose dev tool,
// not a document app that should linger in the dock)
app.on( "window-all-closed", () =>
{
    app.quit();
} );
