//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Print } from "./model/Print";

//
// One mailpiece's detail — status, cost, address verification stamp (print-8.1).
//
export class GetPrintMailpiece extends RestfulEndpoint< GetPrintMailpiece.Query, undefined, GetPrintMailpiece.Response >
{
    public readonly uri      : string = GetPrintMailpiece.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getPrintMailpiece",
        summary:     "Get a mailpiece",
        description: "Reads one mailpiece's detail — status, cost estimate, address verification stamp.",
        tags:        [ "Print" ],
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetPrintMailpiece
{
    export const URI : string = apiPath( "print", 1, "/mailpieces/:id" );
    export interface Query { id : string; }
    export interface Response { mailpiece : Print.Mailpiece; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default GetPrintMailpiece;
// eof
