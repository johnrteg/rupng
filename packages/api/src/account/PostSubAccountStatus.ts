//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Account } from "./model/Account";

//
// Change a direct sub-account's status (suspend / reactivate). ACCOUNT-gated; the target must be a direct
// child of the acting account. SUSPENDING cascades to every descendant; REACTIVATING lifts only the
// suspensions that the cascade created (descendants suspended on their own stay suspended).
//
export class PostSubAccountStatus extends RestfulEndpoint<PostSubAccountStatus.Query, PostSubAccountStatus.Body, PostSubAccountStatus.Response>
{
    public readonly uri      : string = PostSubAccountStatus.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( subAccountId? : string, body? : PostSubAccountStatus.Body ) { super( { subAccountId: subAccountId ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "subAccountId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "status" ],
            properties: {
                status: { type: "string", enum: [ Account.Status.SUSPENDED, Account.Status.ACTIVE ] },
                reason: { type: "string" },
            },
        };
    }
}

export namespace PostSubAccountStatus
{
    export const URI : string = apiPath( "acct", 1, "/sub-accounts/:subAccountId/status" );
    export interface Query { subAccountId : string; }
    export interface Body extends RestfulEndpoint.AuthRequest
    {
        status : Account.Status;   // SUSPENDED | ACTIVE (validated in the schema)
        reason? : string;          // optional note stored on suspend
    }
    export interface Response { subAccountId : string; status : Account.Status; cascaded : number; }   // cascaded = descendants also changed
    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN             = NetworkUtils.Status.FORBIDDEN,          // target isn't a direct child of the acting account
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostSubAccountStatus;
