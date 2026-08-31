//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Nudge a stuck in-flight registration (registration-11.7) — re-pokes the CSP/TCR out-of-band of the poll
// cadence, and/or nudges the account (e.g. an email reminder) to complete KYC/remediation. Doesn't change
// status by itself. Staff-facing (SUPPORT — the floor of the staff ladder) — an ops action taken on behalf of
// an account, not something an account triggers on itself, but not consequential enough to need more than
// baseline support access.
//
export class PostRegistrationNudge extends RestfulEndpoint< {}, PostRegistrationNudge.Body, PostRegistrationNudge.Response >
{
    public readonly uri      : string = PostRegistrationNudge.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AppRole.SUPPORT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "nudgeRegistration",
        summary:     "Nudge a stuck registration (staff)",
        description: "Re-pokes the CSP/TCR for a stuck in-flight registration out-of-band of the poll cadence, and/or notifies the account to complete KYC/remediation. Doesn't change status.",
        tags:        [ "Registration" ],
    };

    constructor( body? : PostRegistrationNudge.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            // exactly-one-of brandId/campaignId is checked in the impl (see PostRegistrationResubmit's note)
            type: "object", additionalProperties: true,
            properties: {
                brandId:       { type: "string" },
                campaignId:    { type: "string" },
                notifyAccount: { type: "boolean" },
            },
        };
    }
}

export namespace PostRegistrationNudge
{
    export const URI : string = apiPath( "registration", 1, "/nudge" );

    export interface Body extends RestfulEndpoint.AuthRequest
    {
        brandId?        : string;
        campaignId?     : string;
        notifyAccount?  : boolean;   // also send the account a KYC/remediation reminder
    }

    export interface Response { nudged : boolean; }

    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PostRegistrationNudge;
// eof
