//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Account } from "./model/Account";

//
// Create a sub-account under the acting account. The caller (an ACCOUNT admin) becomes the new account's
// OWNER + admin member. Enforces the configured hierarchy caps (maxDepth, maxSubAccountsPerParent) and seeds
// parentAccess from config. ACCOUNT-gated.
//
export class PostSubAccount extends RestfulEndpoint<{}, PostSubAccount.Body, PostSubAccount.Response>
{
    public readonly uri      : string = PostSubAccount.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createSubAccount",
        summary:     "Create a sub-account",
        description: "Creates a sub-account under the acting account; the caller becomes its owner + admin. Enforces the configured hierarchy caps (depth / fan-out).",
        tags:        [ "Account" ],
        errors:      { 409: "Hierarchy cap reached (max depth or sub-accounts per parent)" },
    };

    constructor( body? : PostSubAccount.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        // loose (formatless) schema — the client body validator rejects unknown formats
        return {
            type: "object", additionalProperties: false, required: [ "name" ],
            properties: {
                name:         { type: "string", minLength: 1 },
                organization: { type: "object", additionalProperties: true },
                carryOver:    { type: "object", additionalProperties: true },
            },
        };
    }

    // success body — the created sub-account node
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object",
            required: [ "account" ],
            properties: {
                account: {
                    type: "object",
                    properties: {
                        id:        { type: "string", description: "Sub-account id." },
                        name:      { type: "string", description: "Display name." },
                        status:    { type: "string", description: "Account status." },
                        ownerId:   { type: "string", description: "The owner (the admin who created it)." },
                        createdAt: { type: "string", format: "date-time" },
                    },
                },
            },
        };
    }
}

export namespace PostSubAccount
{
    export const URI : string = apiPath( "acct", 1, "/sub-accounts" );

    /** Which fields to copy from the parent account into the new sub-account (server-side, authoritative).
     *  Extensible — add flags here as more fields become carry-over-able. */
    export interface CarryOver
    {
        address? : boolean;
    }

    export interface Body extends RestfulEndpoint.AuthRequest
    {
        name          : string;
        organization? : Account.Organization;   // defaults to the parent's organization when omitted
        carryOver?    : CarryOver;               // fields to copy from the parent (e.g. address)
    }
    export interface Response { account : Account.SubAccount; }
    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN             = NetworkUtils.Status.FORBIDDEN,
        CONFLICT              = NetworkUtils.Status.CONFLICT,          // hierarchy cap reached (depth / fan-out)
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostSubAccount;
