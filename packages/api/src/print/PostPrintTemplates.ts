//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Print } from "./model/Print";

//
// Create a print template (print-1.1/3.3) — the SVG-canvas schema (authored in web); print compiles it down to
// a provider template at render time.
//
export class PostPrintTemplates extends RestfulEndpoint< {}, PostPrintTemplates.Body, PostPrintTemplates.Response >
{
    public readonly uri      : string = PostPrintTemplates.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createPrintTemplate",
        summary:     "Create a print template",
        description: "Creates a print template (name + type + SVG-canvas schema).",
        tags:        [ "Print" ],
    };

    constructor( body? : PostPrintTemplates.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "name", "type" ],
            properties: {
                name: { type: "string" },
                type: { type: "string", enum: Object.values( Print.MailpieceType ) },
                schema: { type: "object" },
            },
        };
    }
}

export namespace PostPrintTemplates
{
    export const URI : string = apiPath( "print", 1, "/templates" );
    // accountId is deliberately NOT part of the body — see PostPrintProof.Body's note.
    export interface Body extends RestfulEndpoint.AuthRequest { name : string; type : Print.MailpieceType; schema? : Record<string, unknown>; }
    export interface Response { template : Print.Template; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default PostPrintTemplates;
// eof
