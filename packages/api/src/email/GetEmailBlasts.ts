//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Email } from "./model/Email";

//
// List the account's email blasts (email-1.9), optionally filtered by status — the monitoring surface for
// scheduled / in-progress / completed sends (drives suspend/resume/reschedule/cancel controls).
//
export class GetEmailBlasts extends RestfulEndpoint< GetEmailBlasts.Query, undefined, GetEmailBlasts.Response >
{
    public readonly uri      : string = GetEmailBlasts.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listEmailBlasts",
        summary:     "List email blasts",
        description: "Lists the account's batch/scheduled email blasts, optionally filtered by status.",
        tags:        [ "Email" ],
    };

    constructor( query? : GetEmailBlasts.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    { return [ { field: "status", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetEmailBlasts
{
    export const URI : string = apiPath( "email", 1, "/blasts" );
    export interface Query { status? : Email.BlastStatus; }
    export interface Response { records : Array<Email.Blast>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default GetEmailBlasts;
// eof
