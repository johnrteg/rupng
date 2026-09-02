//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Texting } from "../texting/model/Texting";
import { PhoneNumber } from "./model/PhoneNumber";
import { Paging } from "../model/Paging";

//
// List the caller's account's owned numbers (paged), optionally filtered by type/status. Read-only — USER
// (mirrors GetRegistrationCampaigns).
//
export class GetRegistrationNumbers extends RestfulEndpoint< GetRegistrationNumbers.Query, undefined, GetRegistrationNumbers.Response >
{
    public readonly uri      : string = GetRegistrationNumbers.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listRegistrationNumbers",
        summary:     "List owned numbers",
        description: "Lists the account's owned numbers (paged — ?count/?start; optionally filtered by numberType/status).",
        tags:        [ "Registration" ],
    };

    constructor( query? : GetRegistrationNumbers.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false,
            properties: {
                numberType: { type: "string", enum: Object.values( Texting.NumberType ) },
                status:     { type: "string", enum: Object.values( PhoneNumber.OrderStatus ) },
                count:      { type: "number" },
                start:      { type: "string" },
            },
        };
    }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetRegistrationNumbers
{
    export const URI : string = apiPath( "registration", 1, "/numbers" );
    export interface Query extends Paging.Request { numberType? : Texting.NumberType; status? : PhoneNumber.OrderStatus; }
    export interface Response extends Paging.Result<PhoneNumber.PhoneNumber> {}
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default GetRegistrationNumbers;
// eof
