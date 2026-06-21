import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";

import { registerIpc } from "./ipc";

//
// Main process entry. Creates the window, loads the renderer (dev server URL in `electron-vite dev`,
// built file otherwise), and wires the IPC surface. Local-only desktop tool — no SSL, no remote.
//

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

    app.on( "activate", () =>
    {
        if ( BrowserWindow.getAllWindows().length === 0 ) createWindow();
    } );
} );

// quit when the last window closes — on every platform, including macOS (a single-purpose dev tool,
// not a document app that should linger in the dock)
app.on( "window-all-closed", () =>
{
    app.quit();
} );
