//
import { ResultUtils, type Type } from "@repo/common";

//
// CvClient — a thin, typed wrapper around Campaign Verify's API (registration-11.3). CV is a distinct
// third-party political-brand vetting product whose result is bridged INTO TCR as an imported vetting token,
// which is why it's a separate client from `TcrClient` rather than another method on it: different host,
// different credential, different lifecycle (PIN-by-mail → verification → token).
//
// Same posture as TcrClient: every method returns a `Type.Result` and never throws, and request/response
// bodies stay `Record<string, unknown>` because CV's exact wire format isn't verifiable from inside this repo.
// The method SURFACE is what the domain layer codes against.
//
export class CvClient
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * @param credential the resolved Campaign Verify credential (Secrets Manager, referenced by
     *                   `RegistrationConfig.Config.cvSecretRef`).
     */
    constructor( private readonly credential : CvClient.Credential ) {}

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Open a verification for a political brand — CV mails/sends a PIN to the entity of record, so this
     *  returns immediately with a pending id and the real outcome arrives on the CV webhook. */
    public submitVerification( payload : Record<string, unknown> ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return this.request( "POST", "/verifications", payload );
    }

    /** Poll CV's current view of a verification — the reconciliation read for the CV half of the brand
     *  state machine (used by the poll sweep when a CV webhook was missed). */
    public getStatus( cvId : string ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return this.request( "GET", `/verifications/${ encodeURIComponent( cvId ) }` );
    }

    /** Submit the PIN the brand received, advancing PIN_SENT → PIN_INPUTTED. */
    public submitPin( cvId : string, pin : string ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return this.request( "POST", `/verifications/${ encodeURIComponent( cvId ) }/pin`, { pin } );
    }

    /** Mint the CV token that gets imported into TCR as the brand's vetting record — the bridge step that
     *  turns a CV approval into a TCR trust score. */
    public createToken( cvId : string ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return this.request( "POST", `/verifications/${ encodeURIComponent( cvId ) }/token` );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ONE HTTP round-trip, bearer-authed, JSON in/out — the whole fallible body sits inside
    // `ResultUtils.from`, so no public method above can throw.
    private request( method : string, path : string, payload? : Record<string, unknown> ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return ResultUtils.from( async () : Promise<Record<string, unknown>> =>
        {
            const url : string = `${ this.credential.baseUrl.replace( /\/+$/, "" ) }${ path }`;
            const response : Response = await fetch( url, {
                method,
                headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${ this.credential.apiKey }` },
                body:    payload === undefined ? undefined : JSON.stringify( payload ),
            } );

            const text : string = await response.text();
            if( !response.ok ) throw new Error( `Campaign Verify ${ method } ${ path } failed (${ response.status }): ${ text.slice( 0, 512 ) }` );
            if( text.trim().length === 0 ) return {};
            return JSON.parse( text ) as Record<string, unknown>;
        } );
    }
}

export namespace CvClient
{
    /** The shape of the `registration-campaign-verify` secret (see @repo/system's Providers catalog). */
    export interface Credential { apiKey : string; baseUrl : string; }
}

export default CvClient;
// eof
