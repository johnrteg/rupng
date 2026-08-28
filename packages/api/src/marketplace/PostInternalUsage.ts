//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import type { Type } from "@repo/common";

//
// S2S: the connector runtime reports usage signals (calls/syncs/actions/records) for an installation.
// Best-effort deltas — metered from day one regardless of price (marketplace-8.1).
//
export class PostInternalUsage extends RestfulEndpoint< {}, PostInternalUsage.Body, PostInternalUsage.Response >
{
    public readonly uri      : string = PostInternalUsage.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    constructor( body? : PostInternalUsage.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "accountId", "integrationId" ],
            properties: {
                accountId:     { type: "string" },
                integrationId: { type: "string" },
                instanceId:    { type: "string" },
                calls:         { type: "number" },
                syncs:         { type: "number" },
                actions:       { type: "number" },
                records:       { type: "number" },
            },
        };
    }
}

export namespace PostInternalUsage
{
    export const URI : string = apiPath( "marketplace", 1, "/internal/usage" );

    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        accountId:     Type.UUID;
        integrationId: string;
        instanceId?:   string;
        calls?:        number;
        syncs?:        number;
        actions?:      number;
        records?:      number;
    }

    export interface Response { ok : boolean; }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostInternalUsage;
