//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Email } from "./model/Email";

//
// List the account's email send-log rows (email-8.1), newest first — the data source for the Messages : Sent
// view. Optionally filtered by status (e.g. only BOUNCED).
//
export class GetEmailLog extends RestfulEndpoint< GetEmailLog.Query, undefined, GetEmailLog.Response >
{
    public readonly uri      : string = GetEmailLog.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listEmailLog",
        summary:     "List sent emails",
        description: "Lists the account's email send-log rows (one per attempted message + its status), newest first.",
        tags:        [ "Email" ],
    };

    constructor( query? : GetEmailLog.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    { return [ { field: "status", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetEmailLog
{
    export const URI : string = apiPath( "email", 1, "/log" );
    export interface Query { status? : Email.Status; }
    export interface Response { records : Array<Email.SendLog>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default GetEmailLog;
// eof
