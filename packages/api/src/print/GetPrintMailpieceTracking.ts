//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Print } from "./model/Print";

//
// A mailpiece's USPS tracking-event timeline (print-4.1) — in_production → mailed → in_transit → delivered,
// or returned/undeliverable.
//
export class GetPrintMailpieceTracking extends RestfulEndpoint< GetPrintMailpieceTracking.Query, undefined, GetPrintMailpieceTracking.Response >
{
    public readonly uri      : string = GetPrintMailpieceTracking.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getPrintMailpieceTracking",
        summary:     "Get a mailpiece's tracking timeline",
        description: "Lists the USPS scan tracking events relayed for one mailpiece, oldest first.",
        tags:        [ "Print" ],
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetPrintMailpieceTracking
{
    export const URI : string = apiPath( "print", 1, "/mailpieces/:id/tracking" );
    export interface Query { id : string; }
    export interface Response { events : Array<Print.TrackingEvent>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default GetPrintMailpieceTracking;
// eof
