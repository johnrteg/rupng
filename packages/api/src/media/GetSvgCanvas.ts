//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { SvgDocument } from "./model/SvgDocument";

// Load a project's SvgDocument.Doc (the editable JSON, stored in S3) plus the S3 key it lives at. Kept
// separate from the project record so listing projects stays light and the doc can grow.
export class GetSvgCanvas extends RestfulEndpoint<GetSvgCanvas.Query, undefined, GetSvgCanvas.Response>
{
    public readonly uri      : string = GetSvgCanvas.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( projectId? : string ) { super( { projectId: projectId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [ { field: "projectId", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true } ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "projectId" ],
            properties: { projectId: { type: "string", minLength: 1 } },
        };
    }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetSvgCanvas
{
    export const URI : string = apiPath( "media", 1, "/svg/canvas" );
    export interface Query { projectId : string; }
    export interface Response { doc : SvgDocument.Doc; canvasKey : string; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetSvgCanvas;
