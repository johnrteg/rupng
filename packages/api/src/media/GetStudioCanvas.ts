//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

// Fetch a project's tldraw CANVAS snapshot (a JSON string stored in S3), or null when the project has none
// saved yet. Kept separate from the project record so listing projects stays light and the canvas can grow.
export class GetStudioCanvas extends RestfulEndpoint<GetStudioCanvas.Query, undefined, GetStudioCanvas.Response>
{
    public readonly uri      : string = GetStudioCanvas.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetStudioCanvas
{
    export const URI : string = apiPath( "media", 1, "/projects/:id/canvas" );
    export interface Query { id : string; }
    export interface Response { canvas : string | null; }   // the tldraw snapshot JSON, or null if unsaved
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetStudioCanvas;
