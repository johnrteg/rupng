//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Registration } from "./model/Registration";

//
// Partially update a brand's user-submittable fields (registration-1.0/3.2 remediation loop). Only meaningful
// while the brand hasn't been accepted by TCR (DRAFT) or is being edited for resubmission after rejection —
// the impl enforces which statuses allow an edit; this contract just accepts the same submittable subset as
// PostRegistrationBrand, all optional.
//
export class PatchRegistrationBrand extends RestfulEndpoint< PatchRegistrationBrand.Query, PatchRegistrationBrand.Body, PatchRegistrationBrand.Response >
{
    public readonly uri      : string = PatchRegistrationBrand.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "updateRegistrationBrand",
        summary:     "Update a brand",
        description: "Partially updates a brand's user-submittable fields.",
        tags:        [ "Registration" ],
    };

    constructor( brandId? : string, body? : PatchRegistrationBrand.Body ) { super( { brandId: brandId ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "brandId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true,
            properties: {
                entityType:         { type: "string", enum: Object.values( Registration.EntityType ) },
                firstName:          { type: "string" },
                lastName:           { type: "string" },
                companyName:        { type: "string" },
                ein:                { type: "string" },
                einIssuingCountry:  { type: "string" },
                stockSymbol:        { type: "string" },
                stockExchange:      { type: "string" },
                email:              { type: "string" },
                phone:              { type: "string" },
                street:             { type: "string" },
                city:               { type: "string" },
                state:              { type: "string" },
                postalCode:         { type: "string" },
                country:            { type: "string" },
                website:            { type: "string" },
                vertical:           { type: "string", enum: Object.values( Registration.Vertical ) },
                politicalType:      { type: "string", enum: Object.values( Registration.PoliticalType ) },
                altBusinessId:      { type: "string" },
                altBusinessIdType:  { type: "string" },
            },
        };
    }
}

export namespace PatchRegistrationBrand
{
    export const URI : string = apiPath( "registration", 1, "/brand/:brandId" );
    export interface Query { brandId : string; }

    export interface Body extends RestfulEndpoint.AuthRequest,
        Partial<Pick<Registration.Brand,
            "entityType" | "firstName" | "lastName" | "companyName" | "ein" | "einIssuingCountry" |
            "stockSymbol" | "stockExchange" | "email" | "phone" | "street" | "city" | "state" |
            "postalCode" | "country" | "website" | "vertical" | "politicalType" | "altBusinessId" | "altBusinessIdType">> {}

    export interface Response extends Registration.Brand {}

    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PatchRegistrationBrand;
// eof
