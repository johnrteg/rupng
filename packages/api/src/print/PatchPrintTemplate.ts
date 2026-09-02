//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Print } from "./model/Print";

//
// Edit a print template (print-1.1) — partial update of name/schema.
//
export class PatchPrintTemplate extends RestfulEndpoint< PatchPrintTemplate.Query, PatchPrintTemplate.Body, PatchPrintTemplate.Response >
{
    public readonly uri      : string = PatchPrintTemplate.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "updatePrintTemplate",
        summary:     "Edit a print template",
        description: "Partially updates a print template's name and/or schema.",
        tags:        [ "Print" ],
    };

    constructor( id? : string, body? : PatchPrintTemplate.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, properties: { name: { type: "string" }, schema: { type: "object" } } };
    }
}

export namespace PatchPrintTemplate
{
    export const URI : string = apiPath( "print", 1, "/templates/:id" );
    export interface Query { id : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { name? : string; schema? : Record<string, unknown>; }
    export interface Response { template : Print.Template; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PatchPrintTemplate;
// eof
