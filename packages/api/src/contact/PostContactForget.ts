//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Trigger a GDPR forget (contact-10.3) — produces a redacted tombstone (the `uuid` shell is
// retained; every PII field is irreversibly purged) and fans the erasure out to every
// content-holding service's `/internal/erase` S2S hook. Account-scoped compliance action
// (ACCOUNT), not a routine contact edit — irreversible. Enqueues onto `contact-forget`; the
// worker does the redaction + fan-out + PURGED emit off the request path.
//
export class PostContactForget extends RestfulEndpoint< {}, PostContactForget.Body, PostContactForget.Response >
{
    public readonly uri      : string = PostContactForget.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "postContactForget",
        summary:     "GDPR-forget a contact",
        description: "Produces a redacted tombstone and fans the erasure out to every content-holding service. Irreversible.",
        tags:        [ "Contact" ],
    };

    constructor( body? : PostContactForget.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "contactId" ],
            properties: { contactId: { type: "string" }, reason: { type: "string" } },
        };
    }
}

export namespace PostContactForget
{
    export const URI : string = apiPath( "contact", 1, "/forget" );
    export interface Body extends RestfulEndpoint.AuthRequest { contactId : string; reason? : string; }
    export interface Response { queued : boolean; }
    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostContactForget;
// eof
