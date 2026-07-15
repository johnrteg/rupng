//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Account } from "./model/Account";

//
// Invite a user (by email) to the acting account at a role. Admin-only. If the email is already a user,
// they're added on their next app load (their pending invite is materialized); otherwise a stub invite
// email is sent and the invite is cached until they register. Returns the created invite.
//
export class PostInvite extends RestfulEndpoint<{}, PostInvite.Body, PostInvite.Response>
{
    public readonly uri      : string = PostInvite.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostInvite.Body ) { super( {}, body ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        // NOTE: no `format: "email"` — request-body schemas are validated by a strict, formatless Ajv
        // (unknown formats throw); the impl normalizes/validates the email instead.
        return { type: "object", properties: { email: { type: "string", minLength: 3 }, role: { type: "string" } }, required: [ "email", "role" ], additionalProperties: false };
    }
}

export namespace PostInvite
{
    export const URI : string = apiPath( "acct", 1, "/invites" );   // /api/acct/v1/invites

    export interface Body extends RestfulEndpoint.AuthRequest
    {
        email : string;
        role  : Access.Role;
    }
    export interface Response { invite : Account.Invite; }

    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, CONFLICT = NetworkUtils.Status.CONFLICT, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostInvite;
