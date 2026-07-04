//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Account } from "./model/Account";

//
// Update the caller's ACTING account (the X-Account header). Admin-only (Access.AccountRole.ACCOUNT) —
// enforced by the authorizer. Body is the editable subset (Account.Update); identity + lifecycle fields
// aren't touched. Returns the updated Account.Entity.
//
//   client:
//   const endpt = new PutAccount( { name: "Acme, Inc.", timezone: "America/New_York" } );
//   const reply = await appdata.server.fetch( endpt );   // → updated Account.Entity
//
export class PutAccount extends RestfulEndpoint<{}, Account.Update, PutAccount.Response>
{
    public readonly uri      : string = PutAccount.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PUT;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;   // account admin (owner/admin)
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : Account.Update )
    {
        super( {}, body );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }

    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        // loose object — the impl merges only the known editable keys; nested shapes owned by their types
        return { type: "object", additionalProperties: true };
    }
}

export namespace PutAccount
{
    export const URI : string = apiPath( "acct", 1, "/account" );   // PUT /api/acct/v1/account

    export interface Response extends Account.Entity
    {
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN             = NetworkUtils.Status.FORBIDDEN,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PutAccount;
