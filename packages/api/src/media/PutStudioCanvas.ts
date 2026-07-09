//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

// Save a project's tldraw CANVAS snapshot (a JSON string) to S3, and re-stamp the project's modified fields.
// This is the low-cadence server sync behind the editor's instant localStorage autosave.
export class PutStudioCanvas extends RestfulEndpoint<PutStudioCanvas.Query, PutStudioCanvas.Body, PutStudioCanvas.Response>
{
    public readonly uri      : string = PutStudioCanvas.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PUT;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( id? : string, body? : PutStudioCanvas.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "canvas" ],
            properties: { canvas: { type: "string" } },
        };
    }
}

export namespace PutStudioCanvas
{
    export const URI : string = apiPath( "media", 1, "/projects/:id/canvas" );
    export interface Query { id : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { canvas : string; }   // the tldraw snapshot JSON
    export interface Response { savedAt : string; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PutStudioCanvas;
