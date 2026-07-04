//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Transfer ownership of the acting account to another EXISTING member (e.g. the current owner has left the
// company). Any ACCOUNT admin may do this — the outgoing owner needn't be reachable. The new owner is
// promoted to ACCOUNT (admin) if they weren't already. ACCOUNT-gated.
//
export class PostOwnerTransfer extends RestfulEndpoint<{}, PostOwnerTransfer.Body, PostOwnerTransfer.Response>
{
    public readonly uri      : string = PostOwnerTransfer.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostOwnerTransfer.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, required: [ "userId" ], properties: { userId: { type: "string", minLength: 1 } } };
    }
}

export namespace PostOwnerTransfer
{
    export const URI : string = apiPath( "acct", 1, "/owner/transfer" );
    export interface Body extends RestfulEndpoint.AuthRequest { userId : string; }   // the new owner (must be a member)
    export interface Response { ownerId : string; }
    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN             = NetworkUtils.Status.FORBIDDEN,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,          // target is not a member
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostOwnerTransfer;
