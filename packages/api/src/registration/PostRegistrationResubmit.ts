//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Registration } from "./model/Registration";

//
// Resubmit a REJECTED brand or campaign after editing (registration-3.2/11.4 — the remediation loop). Exactly
// one of brandId/campaignId is set; `fields` carries the edited subset (same shape as the entity's PATCH body)
// to apply before resubmitting. Async — enqueues the RegistrationSubmitJob and returns 202.
//
export class PostRegistrationResubmit extends RestfulEndpoint< {}, PostRegistrationResubmit.Body, PostRegistrationResubmit.Response >
{
    public readonly uri      : string = PostRegistrationResubmit.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "resubmitRegistration",
        summary:     "Resubmit a rejected brand or campaign",
        description: "Edits + resubmits a rejected brand or campaign (exactly one of brandId/campaignId, plus the edited fields). Async — returns 202.",
        tags:        [ "Registration" ],
    };

    constructor( body? : PostRegistrationResubmit.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            // exactly-one-of brandId/campaignId is checked in the impl, not the schema (Ajv oneOf across
            // sibling optional properties is brittle) — same loose-body-validation posture as PostVoiceCalls
            type: "object", additionalProperties: true, required: [ "fields" ],
            properties: {
                brandId:    { type: "string" },
                campaignId: { type: "string" },
                fields:     { type: "object" },
            },
        };
    }
}

export namespace PostRegistrationResubmit
{
    export const URI : string = apiPath( "registration", 1, "/resubmit" );

    export interface Body extends RestfulEndpoint.AuthRequest
    {
        brandId?    : string;
        campaignId? : string;
        fields      : Partial<Registration.Brand> | Partial<Registration.Campaign>;
    }

    export interface Response { queued : boolean; jobId? : string; }

    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PostRegistrationResubmit;
// eof
