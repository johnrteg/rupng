//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Registration } from "./model/Registration";
import { Paging } from "../model/Paging";

//
// Staff/list view across ALL accounts' brands (paginated), mirroring GetVoiceFlows's list shape. Cross-account
// listing is staff-only — an account's own single brand is fetched via GetRegistrationBrand instead.
//
export class GetRegistrationBrands extends RestfulEndpoint< GetRegistrationBrands.Query, undefined, GetRegistrationBrands.Response >
{
    public readonly uri      : string = GetRegistrationBrands.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AppRole.SUPPORT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listRegistrationBrands",
        summary:     "List brands (staff)",
        description: "Lists brands across accounts (paged — ?count/?start; optionally filtered by accountId/status). Staff-only cross-account view.",
        tags:        [ "Registration" ],
    };

    constructor( query? : GetRegistrationBrands.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false,
            properties: {
                accountId: { type: "string" },
                status:    { type: "string", enum: Object.values( Registration.BrandStatus ) },
                count:     { type: "number" },
                start:     { type: "string" },
            },
        };
    }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetRegistrationBrands
{
    export const URI : string = apiPath( "registration", 1, "/brands" );
    export interface Query extends Paging.Request { accountId? : string; status? : Registration.BrandStatus; }
    export interface Response extends Paging.Result<Registration.Brand> {}
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default GetRegistrationBrands;
// eof
