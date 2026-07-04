import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";

import { registerIpc } from "./ipc";
import { processManager } from "./processManager";
import { reapStale } from "./processScan";
import { closeBrowser } from "./browser";
import { IPC, PROXY_DEFAULT_PORT } from "../shared/types";

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

/** Create the main console window, wire its lifecycle handlers, and load the renderer (dev URL in
 *  `electron-vite dev`, the built index.html otherwise). */
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

    // Quitting via the window's close button: intercept so we can run local services DOWN (and show the
    // "please wait" overlay) BEFORE the window is destroyed — same graceful path as Cmd+Q / menu-quit.
    mainWindow.on( "close", ( event : Electron.Event ) =>
    {
        if ( !shuttingDown ) { event.preventDefault(); void gracefulQuit(); }
    } );

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

    // sweep orphaned rup dev processes left by a prior (hard-killed) session BEFORE we start anything —
    // so leftovers can't hold ports or shadow fresh runs with stale env. Nothing is tracked yet, so this
    // reaps every rup process found (the console's own pid + ancestors are guarded inside reapStale).
    const swept : number = reapStale( processManager.ownedPids() ).killed;
    if ( swept > 0 ) console.log( `[startup] reaped ${swept} orphaned rup process tree(s) from a prior session` );

    createWindow();

    // start the local edge (webproxy) on launch — it serves the SPA + proxies APIs to running
    // services. Uses the console's `.active` routing config if present, else the committed `local`.
    processManager.startProxy( PROXY_DEFAULT_PORT );

    app.on( "activate", () =>
    {
        if ( BrowserWindow.getAllWindows().length === 0 ) createWindow();
    } );
} );

// Graceful quit: show a "stopping local services…" overlay, then run EVERY spawned process tree down
// (and wait for it) before exiting — so nothing orphans holding ports. Guarded so the multiple quit
// entry points (Cmd+Q → before-quit, window close button, window-all-closed) only run it once.
let shuttingDown : boolean = false;
async function gracefulQuit() : Promise<void>
{
    if ( shuttingDown ) return;
    shuttingDown = true;
    try { mainWindow?.webContents.send( IPC.onShuttingDown ); } catch { /* window already gone */ }
    await new Promise( ( resolve ) => setTimeout( resolve, 90 ) );   // let the overlay paint first
    try { const stopped : number = await processManager.shutdownGraceful(); console.log( `[shutdown] stopped ${stopped} local process(es)` ); }
    catch ( err ) { console.error( "[shutdown] error:", err ); processManager.shutdown(); }
    app.exit( 0 );   // hard exit AFTER teardown — skips re-entrant before-quit/will-quit
}

// Cmd+Q / menu-quit comes through before-quit (window still alive → the overlay can paint).
app.on( "before-quit", ( event ) => { if ( !shuttingDown ) { event.preventDefault(); void gracefulQuit(); } } );

// belt-and-suspenders: if we ever exit a path that skipped gracefulQuit, still SIGKILL tracked children.
app.on( "will-quit", () => { if ( !shuttingDown ) processManager.shutdown(); } );

// quit when the last window closes — on every platform, including macOS (a single-purpose dev tool,
// not a document app that should linger in the dock)
app.on( "window-all-closed", () =>
{
    app.quit();
} );
