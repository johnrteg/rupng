//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Print } from "./model/Print";

//
// S2S address verify (print-2.1) — e.g. contact-import list hygiene calling ahead of a save, without the
// user-facing route's account-scoped RBAC. Query-encoded (a GET, per SPECS.md) — flat address fields rather
// than a nested object, since query params can't carry structured JSON.
//
export class GetPrintInternalAddressVerify extends RestfulEndpoint< GetPrintInternalAddressVerify.Query, undefined, GetPrintInternalAddressVerify.Response >
{
    public readonly uri      : string = GetPrintInternalAddressVerify.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "verifyPrintAddressInternal",
        summary:     "S2S address verify",
        description: "S2S only — verifies one address (e.g. contact-import hygiene) without account-scoped RBAC.",
        tags:        [ "Print" ],
    };

    constructor( query? : GetPrintInternalAddressVerify.Query ) { super( query ?? {} as GetPrintInternalAddressVerify.Query ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "accountId",  location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true },
            { field: "line1",      location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true },
            { field: "city",       location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true },
            { field: "region",     location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true },
            { field: "postalCode", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true },
            { field: "country",    location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true },
            { field: "line2",      location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "ncoa",       location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", required: [ "accountId", "line1", "city", "region", "postalCode", "country" ],
            properties: {
                accountId: { type: "string" }, line1: { type: "string" }, line2: { type: "string" },
                city: { type: "string" }, region: { type: "string" }, postalCode: { type: "string" },
                country: { type: "string" }, ncoa: { type: "boolean" },
            },
        };
    }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetPrintInternalAddressVerify
{
    export const URI : string = apiPath( "print", 1, "/internal/address/verify" );
    export interface Query { accountId : string; line1 : string; line2? : string; city : string; region : string; postalCode : string; country : string; ncoa? : boolean; }
    export interface Response extends Print.AddressVerifyResult {}
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST }
}

export default GetPrintInternalAddressVerify;
// eof
