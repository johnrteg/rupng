//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Print } from "./model/Print";

//
// List the account's print templates (print-1.1) — the schema/list surface; the designer itself is web.
//
export class GetPrintTemplates extends RestfulEndpoint< {}, undefined, GetPrintTemplates.Response >
{
    public readonly uri      : string = GetPrintTemplates.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listPrintTemplates",
        summary:     "List print templates",
        description: "Lists the account's non-archived print templates.",
        tags:        [ "Print" ],
    };

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetPrintTemplates
{
    export const URI : string = apiPath( "print", 1, "/templates" );
    export interface Response { templates : Array<Print.Template>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default GetPrintTemplates;
// eof
