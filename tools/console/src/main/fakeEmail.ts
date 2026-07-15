import type { FakeEmailListing, FakeEmailConfigResult, FakeEmailSaveResult } from "../shared/types";
import { servicePorts } from "./ports";

//
// Fake-email backend — the console's bridge to the running fake-email service (a DEV-ONLY simulated ESP). It
// talks to the service DIRECTLY over HTTP at its local port (from the ONE port registry), authenticating with
// the well-known default fake key. Powers the Fake → Email Inbox + Config screens. Unlike the SES viewer (which
// reads LocalStack), this reads the fake service's own in-memory store.
//

// the always-accepted default fake key (mirrors FakeService.DEFAULT_KEY) → the shared "default" tenant
const FAKE_KEY : string = "0000-00-0000";

/** The fake-email service's local base URL (its MAIN port from Ports.ts, default 9100). */
function baseUrl() : string
{
    const port : number = servicePorts()[ "FAKE_EMAIL" ]?.main ?? 9100;
    return `http://localhost:${ port }`;
}

/** A GET/PUT/POST against the fake service with the default key; returns parsed JSON or throws. */
async function call( path : string, method : string = "GET", body? : unknown ) : Promise<unknown>
{
    const response : Response = await fetch( `${ baseUrl() }${ path }`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ FAKE_KEY }` },
        body:    body !== undefined ? JSON.stringify( body ) : undefined,
    } );
    if( !response.ok ) throw new Error( `HTTP ${ response.status }` );
    return await response.json();
}

/** List the fake inbox (newest first). Returns a not-ok listing (with a hint) when the service is down. */
export async function fakeInbox() : Promise<FakeEmailListing>
{
    try
    {
        const data : { records? : Array<FakeEmailListing[ "messages" ][ number ]> } = await call( "/v1/messages" ) as { records? : Array<FakeEmailListing[ "messages" ][ number ]> };
        return { ok: true, messages: data.records ?? [] };
    }
    catch( err )
    {
        return { ok: false, messages: [], error: `${ ( err as Error ).message } — is the fake-email service running?` };
    }
}

/** Clear the fake inbox (default tenant). */
export async function fakeClear() : Promise<void>
{
    try { await call( "/v1/_control/reset", "POST", {} ); } catch { /* service down — ignore */ }
}

/** Read the fake behavior config (the JSON knobs). */
export async function fakeConfigGet() : Promise<FakeEmailConfigResult>
{
    try
    {
        const data : { config? : unknown } = await call( "/v1/config" ) as { config? : unknown };
        return { ok: true, config: data.config };
    }
    catch( err ) { return { ok: false, error: ( err as Error ).message }; }
}

/** Save the fake behavior config (parsed JSON). */
export async function fakeConfigSave( config : unknown ) : Promise<FakeEmailSaveResult>
{
    try { await call( "/v1/config", "PUT", { config } ); return { ok: true }; }
    catch( err ) { return { ok: false, error: ( err as Error ).message }; }
}
