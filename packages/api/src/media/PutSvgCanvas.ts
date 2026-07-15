//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { SvgDocument } from "./model/SvgDocument";

// Save a project's SvgDocument.Doc to S3 (a new S3 object version each write) and re-stamp the project's
// updatedAt. Behind the editor's 2-second debounced autosave + the manual Save.
export class PutSvgCanvas extends RestfulEndpoint<{}, PutSvgCanvas.Body, PutSvgCanvas.Response>
{
    public readonly uri      : string = PutSvgCanvas.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PUT;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PutSvgCanvas.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "projectId", "doc" ],
            properties: {
                projectId: { type: "string", minLength: 1 },
                doc:       { type: "object" },   // the full SvgDocument.Doc; validated structurally in the impl
            },
        };
    }
}

export namespace PutSvgCanvas
{
    export const URI : string = apiPath( "media", 1, "/svg/canvas" );
    export interface Body extends RestfulEndpoint.AuthRequest { projectId : string; doc : SvgDocument.Doc; }
    export interface Response { savedAt : string; }   // ISO timestamp
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PutSvgCanvas;
