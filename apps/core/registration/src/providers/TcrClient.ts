//
import { ResultUtils, type Type } from "@repo/common";

//
// TcrClient — a thin, typed wrapper around The Campaign Registry's CSP REST API (registration-6.2: we are a
// DIRECT CSP, so these are OUR credentials, not a reseller's). One method per TCR operation the state machine
// or a lifecycle op (registration-11.x) needs; every method returns a `Type.Result` and NEVER throws — the
// HTTP call is wrapped in `ResultUtils.from`, so a network blip, a 4xx, and a malformed body all surface as
// `{ ok:false }` for the caller to branch on (CLAUDE.md's Results-over-throws rule).
//
// PAYLOAD SHAPES ARE DELIBERATELY LOOSE. TCR's exact wire format isn't verifiable from inside this repo, so
// request/response bodies are modelled as `Record<string, unknown>` rather than invented interfaces — the
// METHOD SURFACE is the contract the domain layer codes against, and tightening a body later is a local
// change here, not a call-site change. Anything we DO depend on (the assigned brand/campaign id, the status
// string) is read defensively through the small typed readers at the bottom of this file.
//
export class TcrClient
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * @param credential the resolved TCR CSP credential (Secrets Manager, referenced by
     *                   `RegistrationConfig.Config.secretRef`) — API key/secret + the environment's base URL.
     */
    constructor( private readonly credential : TcrClient.Credential ) {}

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Brand (registration-1.0) ──────────────────────────────────────────────────────────────

    /** Register a new brand with TCR. The reply carries TCR's OWN assigned brand id, which the projection
     *  stores alongside (never instead of) our local key — see `Registration.Brand.tcrBrandId`. */
    public createBrand( payload : Record<string, unknown> ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return this.request( "POST", "/brand/nonBlocking", payload );
    }

    /** Read TCR's current view of a brand — the reconciliation read (registration-5.1). */
    public getBrand( tcrBrandId : string ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return this.request( "GET", `/brand/${ encodeURIComponent( tcrBrandId ) }` );
    }

    /** Apply an edited brand (the remediation loop's write half — registration-3.2/11.4). */
    public updateBrand( tcrBrandId : string, payload : Record<string, unknown> ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return this.request( "PUT", `/brand/${ encodeURIComponent( tcrBrandId ) }`, payload );
    }

    /** Order an external-vetting run (Aegis/WMC) on a brand — the trust-score input for registration-7.2. */
    public requestVetting( tcrBrandId : string, payload : Record<string, unknown> ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return this.request( "POST", `/brand/${ encodeURIComponent( tcrBrandId ) }/externalVetting`, payload );
    }

    /** TCR's structured rejection feedback for a brand — what registration-3.2 surfaces to the account. */
    public getBrandFeedback( tcrBrandId : string ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return this.request( "GET", `/brand/feedback/${ encodeURIComponent( tcrBrandId ) }` );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Campaign (registration-2.0) ───────────────────────────────────────────────────────────

    /** Submit a new campaign under an APPROVED brand. */
    public createCampaign( payload : Record<string, unknown> ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return this.request( "POST", "/campaign", payload );
    }

    /** Read TCR's current view of a campaign — the reconciliation read. */
    public getCampaign( tcrCampaignId : string ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return this.request( "GET", `/campaign/${ encodeURIComponent( tcrCampaignId ) }` );
    }

    /** Apply an edited campaign (the remediation loop). */
    public updateCampaign( tcrCampaignId : string, payload : Record<string, unknown> ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return this.request( "PUT", `/campaign/${ encodeURIComponent( tcrCampaignId ) }`, payload );
    }

    /** Deactivate a campaign at TCR (stops the monthly charge; the projection goes EXPIRED on the callback). */
    public deleteCampaign( tcrCampaignId : string ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return this.request( "DELETE", `/campaign/${ encodeURIComponent( tcrCampaignId ) }` );
    }

    /** Per-MNO (carrier) metadata for a campaign — daily caps / TPM, mirrored onto `Campaign.mnoMetadata`
     *  and the input to the published trust-score → MPS interface (registration-7.2). */
    public getMnoMetadata( tcrCampaignId : string ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return this.request( "GET", `/campaign/${ encodeURIComponent( tcrCampaignId ) }/mnoMetadata` );
    }

    /** Share a campaign with a downstream connectivity partner (the DCA) so it can provision numbers. */
    public shareCampaign( tcrCampaignId : string, upstreamCnpId : string ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return this.request( "POST", `/campaign/${ encodeURIComponent( tcrCampaignId ) }/sharing/${ encodeURIComponent( upstreamCnpId ) }` );
    }

    /** The per-MNO approval rollup behind `Registration.OperationsStatus`. */
    public getOperationStatus( tcrCampaignId : string ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return this.request( "GET", `/campaign/${ encodeURIComponent( tcrCampaignId ) }/operationStatus` );
    }

    /** Attach an MMS sample to a campaign (TCR requires one for MMS-capable use cases). */
    public uploadMms( tcrCampaignId : string, payload : Record<string, unknown> ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return this.request( "POST", `/campaign/${ encodeURIComponent( tcrCampaignId ) }/attachment`, payload );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Lifecycle operations (registration-11.x) ──────────────────────────────────────────────

    /** Re-submit a rejected/failed entity after an edit (registration-11.4). `kind` picks the resource path so
     *  the domain layer has ONE resubmit call rather than a brand/campaign branch at every site. */
    public resubmit( kind : TcrClient.EntityKind, tcrId : string, payload : Record<string, unknown> ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return this.request( "POST", `/${ kind }/${ encodeURIComponent( tcrId ) }/resubmit`, payload );
    }

    /** Re-poke TCR for a stuck in-flight registration, out-of-band of the poll cadence (registration-11.7).
     *  Doesn't itself change status — it just asks TCR to re-evaluate/re-emit. */
    public nudge( kind : TcrClient.EntityKind, tcrId : string ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return this.request( "POST", `/${ kind }/${ encodeURIComponent( tcrId ) }/nudge` );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ONE HTTP round-trip, Basic-authed, JSON in/out. Everything fallible lives inside the
    // `ResultUtils.from` body so this method — and therefore every public method above — never throws.
    private request( method : string, path : string, payload? : Record<string, unknown> ) : Promise<Type.Result<Record<string, unknown>>>
    {
        return ResultUtils.from( async () : Promise<Record<string, unknown>> =>
        {
            // HTTP Basic over the CSP key/secret pair — TCR's own scheme for the CSP portal API
            const authorization : string = `Basic ${ Buffer.from( `${ this.credential.apiKey }:${ this.credential.apiSecret }` ).toString( "base64" ) }`;
            const url : string = `${ this.credential.baseUrl.replace( /\/+$/, "" ) }${ path }`;

            const response : Response = await fetch( url, {
                method,
                headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: authorization },
                body:    payload === undefined ? undefined : JSON.stringify( payload ),
            } );

            // a non-2xx is a FAILED result, not an exception the caller has to catch — the thrown Error here
            // is captured by `ResultUtils.from` and returned as `{ ok:false, error }`
            const text : string = await response.text();
            if( !response.ok ) throw new Error( `TCR ${ method } ${ path } failed (${ response.status }): ${ text.slice( 0, 512 ) }` );

            // TCR answers some operations (e.g. DELETE) with an empty body — normalize that to `{}` rather
            // than letting JSON.parse throw on "" and surface as a spurious transport failure
            if( text.trim().length === 0 ) return {};
            return JSON.parse( text ) as Record<string, unknown>;
        } );
    }
}

export namespace TcrClient
{
    /** Which TCR resource a shared lifecycle call (`resubmit`/`nudge`) targets — a closed set, so the path
     *  segment can never be an arbitrary string. */
    export enum EntityKind
    {
        BRAND    = "brand",
        CAMPAIGN = "campaign",
    }

    /** The shape of the `registration-tcr` secret (see @repo/system's Providers catalog). */
    export interface Credential { apiKey : string; apiSecret : string; baseUrl : string; }

    /** Defensive read of a string field off a loosely-typed TCR reply — returns undefined rather than
     *  coercing, so a missing/renamed field surfaces as "unknown" instead of the literal "undefined". */
    export function readString( body : Record<string, unknown>, field : string ) : string | undefined
    {
        const value : unknown = body[ field ];
        return typeof value === "string" && value.length > 0 ? value : undefined;
    }

    /** Defensive read of a numeric field off a loosely-typed TCR reply (the vetting/trust score). */
    export function readNumber( body : Record<string, unknown>, field : string ) : number | undefined
    {
        const value : unknown = body[ field ];
        return typeof value === "number" && Number.isFinite( value ) ? value : undefined;
    }
}

export default TcrClient;
// eof
