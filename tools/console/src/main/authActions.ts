import type { AuthActionsListing, AuthActionCancelResult, AuthActionRow } from "../shared/types";
import { servicePorts } from "./ports";

//
// Auth-actions backend — the console's bridge to the running auth service's pending-action queue (verify / reset
// / mfa / invite / unsubscribe). Talks to the service DIRECTLY at its local port via the dev-only RAW control
// routes (`/_control/actions`), which bypass the platform authorizer so the session-less Console can read/cancel.
//

/** The auth service's local base URL (its MAIN port from Ports.ts, default 8110). */
function baseUrl() : string
{
    const port : number = servicePorts()[ "AUTH" ]?.main ?? 8110;
    return `http://localhost:${ port }`;
}

/** A GET/POST against the auth control routes; returns parsed JSON or throws. */
async function call( path : string, method : string = "GET" ) : Promise<unknown>
{
    const response : Response = await fetch( `${ baseUrl() }${ path }`, { method, headers: { "Content-Type": "application/json" } } );
    if( !response.ok ) throw new Error( `HTTP ${ response.status }` );
    return await response.json();
}

/** List the action queue by status (newest first). Returns a not-ok listing (with a hint) when auth is down. */
export async function authActionsList( status : string ) : Promise<AuthActionsListing>
{
    try
    {
        const data : { records? : Array<AuthActionRow> } = await call( `/_control/actions?status=${ encodeURIComponent( status ) }` ) as { records? : Array<AuthActionRow> };
        return { ok: true, records: data.records ?? [] };
    }
    catch( err )
    {
        return { ok: false, records: [], error: `${ ( err as Error ).message } — is the auth service running?` };
    }
}

/** Revoke a pending action by id. */
export async function authActionsCancel( actionId : string ) : Promise<AuthActionCancelResult>
{
    try { await call( `/_control/actions/${ encodeURIComponent( actionId ) }/cancel`, "POST" ); return { ok: true }; }
    catch( err ) { return { ok: false, error: ( err as Error ).message }; }
}
