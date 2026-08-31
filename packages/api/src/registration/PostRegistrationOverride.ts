//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Registration } from "./model/Registration";

//
// Staff break-glass status override (registration-11.6) — manually correct a wrong/stuck projection. Audited:
// a non-empty `reason` is REQUIRED (enforced in the schema's `required`, matching PostVoiceCalls's required-
// field pattern) and every override sets `overridden: true` on the entity + appends a StatusHistoryEntry with
// `overridden: true`. Reconciled against the NEXT sync — an override that contradicts TCR is re-flagged, never
// silently authoritative (TCR stays the source of truth). ROOT only.
//
export class PostRegistrationOverride extends RestfulEndpoint< {}, PostRegistrationOverride.Body, PostRegistrationOverride.Response >
{
    public readonly uri      : string = PostRegistrationOverride.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "overrideRegistrationStatus",
        summary:     "Override a brand/campaign status (staff)",
        description: "Manually corrects a wrong/stuck brand or campaign status. Audited — a reason is required. Reconciled (not authoritative) against the next TCR sync.",
        tags:        [ "Registration" ],
    };

    constructor( body? : PostRegistrationOverride.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            // exactly-one-of brandId/campaignId is checked in the impl (see PostRegistrationResubmit's note);
            // "reason" is REQUIRED + non-empty — this is the audited staff break-glass path
            type: "object", additionalProperties: true, required: [ "status", "reason" ],
            properties: {
                brandId:    { type: "string" },
                campaignId: { type: "string" },
                status:     { type: "string" },
                reason:     { type: "string", minLength: 1 },
            },
        };
    }
}

export namespace PostRegistrationOverride
{
    export const URI : string = apiPath( "registration", 1, "/override" );

    export interface Body extends RestfulEndpoint.AuthRequest
    {
        brandId?    : string;
        campaignId? : string;
        status      : Registration.BrandStatus | Registration.CampaignStatus;
        reason      : string;
    }

    export interface Response { brand? : Registration.Brand; campaign? : Registration.Campaign; }

    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PostRegistrationOverride;
// eof
