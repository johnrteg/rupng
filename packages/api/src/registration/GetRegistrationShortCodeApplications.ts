//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { PhoneNumber } from "./model/PhoneNumber";
import { Paging } from "../model/Paging";

//
// List the caller's account's short-code applications (paged), optionally filtered by status. Read-only — USER.
//
export class GetRegistrationShortCodeApplications extends RestfulEndpoint< GetRegistrationShortCodeApplications.Query, undefined, GetRegistrationShortCodeApplications.Response >
{
    public readonly uri      : string = GetRegistrationShortCodeApplications.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listRegistrationShortCodeApplications",
        summary:     "List short-code applications",
        description: "Lists the account's short-code applications (paged — ?count/?start; optionally filtered by status).",
        tags:        [ "Registration" ],
    };

    constructor( query? : GetRegistrationShortCodeApplications.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false,
            properties: {
                status: { type: "string", enum: Object.values( PhoneNumber.ShortCodeStatus ) },
                count:  { type: "number" },
                start:  { type: "string" },
            },
        };
    }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetRegistrationShortCodeApplications
{
    export const URI : string = apiPath( "registration", 1, "/shortcodes" );
    export interface Query extends Paging.Request { status? : PhoneNumber.ShortCodeStatus; }
    export interface Response extends Paging.Result<PhoneNumber.ShortCodeApplication> {}
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default GetRegistrationShortCodeApplications;
// eof
