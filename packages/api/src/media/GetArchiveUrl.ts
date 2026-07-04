//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

// A time-limited URL to download a COMPLETE archive's zip (media-20). 404 until the archive is complete.
export class GetArchiveUrl extends RestfulEndpoint<GetArchiveUrl.Query, undefined, GetArchiveUrl.Response>
{
    public readonly uri      : string = GetArchiveUrl.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( archiveId? : string ) { super( { archiveId: archiveId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "archiveId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetArchiveUrl
{
    export const URI : string = apiPath( "media", 1, "/archives/:archiveId/url" );
    export interface Query { archiveId : string; }
    export interface Response { url : string; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default GetArchiveUrl;
