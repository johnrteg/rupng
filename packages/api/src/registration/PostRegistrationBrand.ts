//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Registration } from "./model/Registration";

//
// Create the caller's account brand (registration-1.0/1.1) — brand-per-account: an account has AT MOST one
// brand. Body is the user-submittable subset of Registration.Brand — status/statusHistory/vetting-derived
// fields/timestamps are system-managed (never accepted from the client). Starts DRAFT; a later submit flow
// (registration-2.0's job) pushes it to TCR. ACCOUNT — brand submission is consequential/KYC-bearing.
//
export class PostRegistrationBrand extends RestfulEndpoint< {}, PostRegistrationBrand.Body, PostRegistrationBrand.Response >
{
    public readonly uri      : string = PostRegistrationBrand.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createRegistrationBrand",
        summary:     "Create the account's brand",
        description: "Creates the caller's account brand (brand-per-account — at most one per account). Starts in DRAFT until submitted to TCR.",
        tags:        [ "Registration" ],
    };

    constructor( body? : PostRegistrationBrand.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            // entity-type-conditional fields (sole-proprietor vs company vs public-company) are all optional
            // here per CLAUDE.md's closed-set convention — the impl validates the required subset by entityType
            type: "object", additionalProperties: true,
            required: [ "entityType", "email", "phone", "street", "city", "state", "postalCode", "country", "vertical" ],
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

export namespace PostRegistrationBrand
{
    export const URI : string = apiPath( "registration", 1, "/brand" );

    /** The user-submittable subset of Registration.Brand — no accountId (from the session), no
     *  status/statusHistory/vetting-derived fields/timestamps (system-managed). */
    export interface Body extends RestfulEndpoint.AuthRequest,
        Pick<Registration.Brand,
            "entityType" | "firstName" | "lastName" | "companyName" | "ein" | "einIssuingCountry" |
            "stockSymbol" | "stockExchange" | "email" | "phone" | "street" | "city" | "state" |
            "postalCode" | "country" | "website" | "vertical" | "politicalType" | "altBusinessId" | "altBusinessIdType"> {}

    export interface Response extends Registration.Brand {}

    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        CONFLICT     = NetworkUtils.Status.CONFLICT,
    }
}

export default PostRegistrationBrand;
// eof
