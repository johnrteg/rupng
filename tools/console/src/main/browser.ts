import { BrowserWindow, type Session } from "electron";

import { BROWSER_ID, type BrowserState } from "../shared/types";
import { logStore } from "./logStore";

//
// An in-app browser window for the running web app — its own resizable Chromium window owned by the
// console. We capture the page's console (console.log/warn/error), uncaught errors, and load/crash
// failures via Electron's native webContents events and stream them into the (BROWSER_ID, "runtime")
// log slot — so the Trace view shows the browser console and Claude can read it. No external Chrome,
// no CDP, no extra deps. (It's an embedded Chromium, not your system browser profile.)
//

let win : BrowserWindow | null = null;
let stateCb : ( ( s : BrowserState ) => void ) | null = null;

/** Register a listener so the renderer is told when the window opens/closes/navigates. */
export function onBrowserState( cb : ( s : BrowserState ) => void ) : void { stateCb = cb; }

const SAY = ( m : string ) : void => logStore.sys( BROWSER_ID, "runtime", m );

/** Electron console levels: 0 verbose · 1 info · 2 warning · 3 error → red for warning+. */
function levelStream( level : number ) : "out" | "err" { return level >= 2 ? "err" : "out"; }

/** True if the text is a structured Trace record JSON (so the LogView should render it as a record). */
function isTraceRecord( msg : string ) : boolean
{
    const t : string = msg.trim();
    if ( !t.startsWith( "{" ) ) return false;
    try { const o = JSON.parse( t ) as { level? : unknown; message? : unknown }; return typeof o.level === "string" && "message" in o; }
    catch { return false; }
}

/** Resize the app window's CONTENT (viewport) to emulate a device width/height. */
export function resizeBrowser( width : number, height : number ) : void
{
    if ( browserIsOpen() ) { win!.setContentSize( Math.round( width ), Math.round( height ) ); SAY( `▭ resized viewport to ${width}×${height}` ); }
}

export function browserIsOpen() : boolean { return !!win && !win.isDestroyed(); }

/** Current open/url/history state of the app window. */
export function browserState() : BrowserState
{
    if ( !browserIsOpen() ) return { open: false, url: "", canBack: false, canForward: false };
    const wc = win!.webContents;
    return { open: true, url: wc.getURL(), canBack: wc.navigationHistory.canGoBack(), canForward: wc.navigationHistory.canGoForward() };
}
const emitState = () : void => stateCb?.( browserState() );

/** History navigation (the Run-panel back/forward buttons). did-navigate then refreshes state. */
export function browserBack() : void { if ( browserIsOpen() && win!.webContents.navigationHistory.canGoBack() ) win!.webContents.navigationHistory.goBack(); }
export function browserForward() : void { if ( browserIsOpen() && win!.webContents.navigationHistory.canGoForward() ) win!.webContents.navigationHistory.goForward(); }

/** Open (or focus + navigate) the app window at `url`. Resizable, independent top-level window. */
export function openBrowser( url : string ) : { ok : boolean; url : string }
{
    if ( browserIsOpen() )
    {
        void win!.loadURL( url );
        win!.focus();
        SAY( `↻ navigated to ${url}` );
        emitState();
        return { ok: true, url };
    }

    win = new BrowserWindow( {
        width           : 1200,
        height          : 860,
        title           : "RumbleUp App",
        backgroundColor : "#ffffff",
        // dedicated partition → its own Session, so webRequest monitoring sees ONLY this window's traffic
        webPreferences  : { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: "rup-app" }
    } );

    const wc = win.webContents;
    attachNetwork( wc.session );   // monitor requests this window makes (to the proxy/API)

    // keep the Run-panel URL bar + back/forward buttons in sync with the window's navigation
    wc.on( "did-navigate", () => emitState() );
    wc.on( "did-navigate-in-page", () => emitState() );

    // the page console (console.log/info/warn/error) + console-surfaced uncaught errors. Electron 33
    // emits (event, MessageDetails), but the typings carry an extra deprecated (event, level, …)
    // overload that confuses overload resolution — so we listen via the plain emitter and handle both
    // arg shapes (object = new, number = old).
    ( wc as unknown as NodeJS.EventEmitter ).on( "console-message", ( ...a : unknown[] ) =>
    {
        const d = a[ 1 ] as { level? : number; message? : string; sourceUrl? : string; lineNumber? : number } | number | undefined;
        let level : number, message : string, where : string;
        if ( d && typeof d === "object" )
        {
            level = d.level ?? 0;
            message = String( d.message ?? "" );
            where = d.sourceUrl ? ` (${d.sourceUrl.split( "/" ).pop()}:${d.lineNumber ?? 0})` : "";
        }
        else
        {
            level = Number( d ?? 0 );
            message = String( a[ 2 ] ?? "" );
            const src : string = String( a[ 4 ] ?? "" );
            where = src ? ` (${src.split( "/" ).pop()}:${Number( a[ 3 ] ?? 0 )})` : "";
        }
        // If the page logged a structured Trace record (our shared logger emits JSON), pass it through
        // VERBATIM so the LogView parses + colors it like every other Trace line. Only decorate raw,
        // unstructured console output with the source location (which would otherwise corrupt the JSON).
        const text : string = isTraceRecord( message ) ? message : `${message}${where}`;
        logStore.append( BROWSER_ID, "runtime", levelStream( level ), `${text}\n` );
    } );

    // navigation / load failures (ignore -3 ABORTED, which fires on normal redirects/cancels)
    wc.on( "did-fail-load", ( _e, code, desc, validatedUrl ) =>
    {
        if ( code === -3 ) return;
        logStore.append( BROWSER_ID, "runtime", "err", `✖ failed to load ${validatedUrl}: ${desc} (${code})\n` );
    } );
    wc.on( "render-process-gone", ( _e, details ) =>
    {
        logStore.append( BROWSER_ID, "runtime", "err", `✖ render process gone: ${details.reason}\n` );
    } );

    win.on( "closed", () => { win = null; SAY( "■ app window closed" ); emitState(); } );

    SAY( `\n▶ opening ${url}` );
    void win.loadURL( url );
    emitState();
    return { ok: true, url };
}

/** Hard refresh — reload the page ignoring the cache. */
export function reloadBrowser() : void
{
    if ( browserIsOpen() ) { win!.webContents.reloadIgnoringCache(); SAY( "↻ hard refresh (cache bypassed)" ); }
}

/** Close the app window if open. */
export function closeBrowser() : void
{
    if ( browserIsOpen() ) win!.close();
    win = null;
}

//
// Network monitoring — observe the window's requests (to the proxy / API) via the partition's Session
// webRequest hooks, and emit one Trace-format JSON record per request into the same Trace view (so it
// colors + filters by level and Claude can read it). We log navigations + XHR/fetch (the meaningful
// API traffic), skipping static asset chatter (images/scripts/styles/fonts).
//

const NET_TYPES = new Set( [ "mainFrame", "subFrame", "xhr", "fetch" ] );
const started = new Map<number, number>();   // request id → start ms

/** A Trace.Data-shaped line (name "net") so the console's LogView renders it as a colored record. */
function netLine( level : "INFO" | "WARN" | "ERROR", message : string ) : void
{
    const rec = { level, time: new Date().toISOString(), name: "net", id: "web", message };
    logStore.append( BROWSER_ID, "runtime", level === "INFO" ? "out" : "err", JSON.stringify( rec ) + "\n" );
}

/** "https://host/app/bootstrap?x=1" → "/app/bootstrap?x=1" (host dropped — it's the proxy/gateway). */
function shortUrl( url : string ) : string
{
    try { const u = new URL( url ); return u.pathname + u.search; } catch { return url; }
}

let attachedTo : Session | null = null;
function attachNetwork( ses : Session ) : void
{
    if ( attachedTo === ses ) return;   // the partition session is reused across opens — attach once
    attachedTo = ses;

    ses.webRequest.onSendHeaders( ( d ) => { started.set( d.id, Date.now() ); } );

    ses.webRequest.onCompleted( ( d ) =>
    {
        if ( !NET_TYPES.has( d.resourceType ) ) { started.delete( d.id ); return; }
        const ms : number = started.has( d.id ) ? Date.now() - started.get( d.id )! : 0;
        started.delete( d.id );
        const code : number = d.statusCode;
        const level : "INFO" | "WARN" | "ERROR" = code >= 500 ? "ERROR" : code >= 400 ? "WARN" : "INFO";
        netLine( level, `${d.method} ${shortUrl( d.url )} → ${code} · ${ms}ms` );
    } );

    ses.webRequest.onErrorOccurred( ( d ) =>
    {
        if ( !NET_TYPES.has( d.resourceType ) ) { started.delete( d.id ); return; }
        const ms : number = started.has( d.id ) ? Date.now() - started.get( d.id )! : 0;
        started.delete( d.id );
        if ( d.error === "net::ERR_ABORTED" ) return;   // normal cancels/redirects
        netLine( "ERROR", `${d.method} ${shortUrl( d.url )} ✖ ${d.error} · ${ms}ms` );
    } );
}
