//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Registration } from "./model/Registration";
import { Paging } from "../model/Paging";

//
// S2S: list ALL brands, optionally filtered by accountId/status (paged — `{ records, page }` envelope).
// INTERNAL audience — no user session/X-Account on an S2S call. First consumer: the `report` service, which
// never reads registration's own DB directly (mirrors GetInternalContacts's pattern).
//
export class GetInternalRegistrationBrands extends RestfulEndpoint< GetInternalRegistrationBrands.Query, undefined, GetInternalRegistrationBrands.Response >
{
    public readonly uri      : string = GetInternalRegistrationBrands.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listInternalRegistrationBrands",
        summary:     "List brands (S2S)",
        description: "Lists brands, optionally filtered by accountId/status (paged — ?count/?start; returns { records, page }).",
        tags:        [ "Registration" ],
    };

    constructor( query? : GetInternalRegistrationBrands.Query ) { super( query ?? {} ); }
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

export namespace GetInternalRegistrationBrands
{
    export const URI : string = apiPath( "registration", 1, "/internal/brands" );

    export interface Query extends Paging.Request { accountId? : string; status? : Registration.BrandStatus; }

    export interface Response extends Paging.Result<Registration.Brand> {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetInternalRegistrationBrands;
// eof
