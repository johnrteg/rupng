//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// The account's download archives — the "Downloads" view (media-20). Each carries its status
// (pending / processing / complete / error) + error reason, so the UI shows progress and lets the user
// download (when complete) or delete. Archives are NOT library assets (separate table).
export class GetArchives extends RestfulEndpoint<{}, undefined, GetArchives.Response>
{
    public readonly uri      : string = GetArchives.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetArchives
{
    export const URI : string = apiPath( "media", 1, "/archives" );
    export interface Response { archives : Array<Media.Archive>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST }
}

export default GetArchives;
