//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Texting } from "../texting/model/Texting";
import { Registration } from "./model/Registration";

//
// Search a carrier's available-number inventory (registration-4.x) — LONG_CODE or TOLL_FREE only; SHORT_CODE
// has no self-serve inventory to search (see PostRegistrationShortCodeApplication). Read-only + free, so USER
// access (mirrors GetRegistrationCampaigns) — nothing is committed until PostRegistrationNumberOrder.
//
export class PostRegistrationNumberSearch extends RestfulEndpoint< {}, PostRegistrationNumberSearch.Body, PostRegistrationNumberSearch.Response >
{
    public readonly uri      : string = PostRegistrationNumberSearch.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "searchRegistrationNumbers",
        summary:     "Search available numbers",
        description: "Searches a carrier's available-number inventory (long code or toll-free). Read-only — nothing is ordered.",
        tags:        [ "Registration" ],
    };

    constructor( body? : PostRegistrationNumberSearch.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "numberType", "carrier" ],
            properties: {
                numberType: { type: "string", enum: [ Texting.NumberType.LONG_CODE, Texting.NumberType.TOLL_FREE ] },
                carrier:    { type: "string", enum: Object.values( Registration.CarrierProvider ) },
                areaCode:   { type: "string" },
                contains:   { type: "string" },
                limit:      { type: "number" },
            },
        };
    }
}

export namespace PostRegistrationNumberSearch
{
    export const URI : string = apiPath( "registration", 1, "/number/search" );

    export interface Body extends RestfulEndpoint.AuthRequest
    {
        numberType : Texting.NumberType;
        carrier    : Registration.CarrierProvider;
        areaCode?  : string;
        contains?  : string;
        limit?     : number;
    }

    export interface AvailableNumber { number : string; numberType : Texting.NumberType; monthlyPriceCents? : number; }

    export interface Response { results : Array<AvailableNumber>; }

    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
    }
}

export default PostRegistrationNumberSearch;
// eof
