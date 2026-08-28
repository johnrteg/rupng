//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { Marketplace } from "./model/Marketplace";

//
// S2S: create an Installation for an account + start its connect flow (OAuth authorize session, or a
// validated API-key connect). Called by a consuming service (e.g. social) — never by the browser
// directly; the account-facing enable/accept-to-enable flow (marketplace-2.5) is a later addition.
//
export class PostInstallation extends RestfulEndpoint< {}, PostInstallation.Body, PostInstallation.Response >
{
    public readonly uri      : string = PostInstallation.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    constructor( body? : PostInstallation.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "accountId", "integrationId", "installedBy" ],
            properties: {
                accountId:     { type: "string" },
                integrationId: { type: "string" },
                instanceId:    { type: "string" },
                label:         { type: "string" },
                installedBy:   { type: "string" },
                scopes:        { type: "array", items: { type: "string" } },
            },
        };
    }
}

export namespace PostInstallation
{
    export const URI : string = apiPath( "marketplace", 1, "/internal/installations" );

    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        accountId:     Type.UUID;
        integrationId: string;
        instanceId?:   string;
        label?:        string;
        installedBy:   Type.UUID;
        scopes?:       Array<string>;
    }

    export interface Response
    {
        installationId: Type.UUID;
        connect:        Marketplace.ConnectResult;
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostInstallation;
