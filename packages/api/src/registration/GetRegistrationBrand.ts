//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Registration } from "./model/Registration";

//
// Get a single brand by id (registration-1.0). Direct lookup, mirroring GetVoiceFlow's single-entity-by-id
// shape. Since brand-per-account is a soft cardinality constraint (not an id lookup), the account's own brand
// is more commonly reached by resolving its brandId first (e.g. from GetAccount/GetBilling context) — this
// endpoint is the canonical fetch-by-id once that id is known.
//
export class GetRegistrationBrand extends RestfulEndpoint< GetRegistrationBrand.Query, undefined, GetRegistrationBrand.Response >
{
    public readonly uri      : string = GetRegistrationBrand.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getRegistrationBrand",
        summary:     "Get a brand",
        description: "Fetches a single registered brand by id (the reconciled TCR projection).",
        tags:        [ "Registration" ],
    };

    constructor( brandId? : string ) { super( { brandId: brandId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "brandId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetRegistrationBrand
{
    export const URI : string = apiPath( "registration", 1, "/brand/:brandId" );
    export interface Query { brandId : string; }
    export interface Response extends Registration.Brand {}
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default GetRegistrationBrand;
// eof
