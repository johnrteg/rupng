//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Account usage roll-up — per-integration + total, for one period (defaults to the current month).
// A simple SUM over that period's meter rows, no aggregate table (marketplace-8.2). USER-gated.
//
export class GetUsage extends RestfulEndpoint< GetUsage.Query, undefined, GetUsage.Response >
{
    public readonly uri      : string = GetUsage.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getMarketplaceUsage",
        summary:     "Get account usage roll-up",
        description: "Per-integration + total usage counters for one period (default: current month).",
        tags:        [ "Marketplace" ],
    };

    constructor( query? : GetUsage.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetUsage
{
    export const URI : string = apiPath( "marketplace", 1, "/usage" );

    export interface Query { period? : string; }   // YYYY-MM

    export interface Counters { calls : number; syncs : number; actions : number; records : number; }

    export interface Response
    {
        period:       string;
        byIntegration : Array<Counters & { integrationId : string }>;
        total:        Counters;
    }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetUsage;
