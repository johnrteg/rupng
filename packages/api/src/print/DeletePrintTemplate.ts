//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Archive a print template (print-1.1) — a soft delete (kept for any mailpiece that already references it).
//
export class DeletePrintTemplate extends RestfulEndpoint< DeletePrintTemplate.Query, undefined, DeletePrintTemplate.Response >
{
    public readonly uri      : string = DeletePrintTemplate.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "archivePrintTemplate",
        summary:     "Archive a print template",
        description: "Soft-deletes (archives) a print template.",
        tags:        [ "Print" ],
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace DeletePrintTemplate
{
    export const URI : string = apiPath( "print", 1, "/templates/:id" );
    export interface Query { id : string; }
    export interface Response { archived : true; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default DeletePrintTemplate;
// eof
