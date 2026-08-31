//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Registration } from "./model/Registration";

//
// On-demand force-reconcile one registration with TCR/CSP now (registration-11.8) — the same reconcile the
// poll sweep runs on its own cadence, triggered on request. Synchronous (unlike vetting-refresh/reprovision):
// small, bounded, single-entity TCR read + projection update. Staff-facing (SUPPORT — the floor of the staff
// ladder; a read-mostly reconcile, not consequential enough to need more).
//
export class PostRegistrationCheckSync extends RestfulEndpoint< {}, PostRegistrationCheckSync.Body, PostRegistrationCheckSync.Response >
{
    public readonly uri      : string = PostRegistrationCheckSync.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AppRole.SUPPORT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "checkSyncRegistration",
        summary:     "Force-reconcile a registration (staff)",
        description: "On-demand force-reconciles one brand or campaign with TCR/CSP now (the poll-sweep reconcile, on request).",
        tags:        [ "Registration" ],
    };

    constructor( body? : PostRegistrationCheckSync.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        // exactly-one-of brandId/campaignId is checked in the impl (see PostRegistrationResubmit's note)
        return { type: "object", additionalProperties: true, properties: { brandId: { type: "string" }, campaignId: { type: "string" } } };
    }
}

export namespace PostRegistrationCheckSync
{
    export const URI : string = apiPath( "registration", 1, "/check-sync" );

    export interface Body extends RestfulEndpoint.AuthRequest { brandId? : string; campaignId? : string; }

    export interface Response { brand? : Registration.Brand; campaign? : Registration.Campaign; }

    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PostRegistrationCheckSync;
// eof
