//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Print } from "./model/Print";

//
// List the account's mailpieces (print-8.1), newest first — optionally filtered by campaign/status. The data
// source for the print activity view.
//
export class GetPrintMailpieces extends RestfulEndpoint< GetPrintMailpieces.Query, undefined, GetPrintMailpieces.Response >
{
    public readonly uri      : string = GetPrintMailpieces.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listPrintMailpieces",
        summary:     "List mailpieces",
        description: "Lists the account's mailpieces, newest first, optionally filtered by campaign or status.",
        tags:        [ "Print" ],
    };

    constructor( query? : GetPrintMailpieces.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "campaignId", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "status",     location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetPrintMailpieces
{
    export const URI : string = apiPath( "print", 1, "/mailpieces" );
    export interface Query { campaignId? : string; status? : Print.MailpieceStatus; }
    export interface Response { mailpieces : Array<Print.Mailpiece>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default GetPrintMailpieces;
// eof
