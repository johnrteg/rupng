//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Marketplace } from "./model/Marketplace";

//
// Enable an integration — accept-to-enable (license/terms/privacy + sub-processor ack REQUIRED; an
// escalated `crossBorderAck` is additionally required when the integration's `dataJurisdiction` is
// `US`, per the cross-border transfer gate, marketplace-2.7). Creates the installation in CONFIGURED
// status (not yet connected) — `PostInstallationConnect` starts the OAuth/API-key connect flow
// separately. ACCOUNT-gated (billing + credential implications).
//
export class PostInstallationEnable extends RestfulEndpoint< {}, PostInstallationEnable.Body, PostInstallationEnable.Response >
{
    public readonly uri      : string = PostInstallationEnable.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "enableMarketplaceInstallation",
        summary:     "Enable an integration",
        description: "Creates an installation with config + accept-to-enable acceptance.",
        tags:        [ "Marketplace" ],
        errors:      { 409: "Acceptance required (sub-processor and/or cross-border ack missing)" },
    };

    constructor( body? : PostInstallationEnable.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true, required: [ "integrationId", "config", "accept" ],
            properties: {
                integrationId: { type: "string" },
                instanceId:    { type: "string" },
                label:         { type: "string" },
                config:        { type: "object" },
                accept:        { type: "object" },
            },
        };
    }
}

export namespace PostInstallationEnable
{
    export const URI : string = apiPath( "marketplace", 1, "/installations" );

    export interface Body extends RestfulEndpoint.AuthRequest, Marketplace.EnableRequest {}
    export interface Response extends Marketplace.Installation {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        CONFLICT              = NetworkUtils.Status.CONFLICT,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostInstallationEnable;
