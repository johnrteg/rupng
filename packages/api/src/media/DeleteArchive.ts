//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

// Delete a download archive — its zip bytes (S3) + the record (media-20).
export class DeleteArchive extends RestfulEndpoint<DeleteArchive.Query, undefined, DeleteArchive.Response>
{
    public readonly uri      : string = DeleteArchive.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( archiveId? : string ) { super( { archiveId: archiveId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "archiveId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteArchive
{
    export const URI : string = apiPath( "media", 1, "/archives/:archiveId" );
    export interface Query { archiveId : string; }
    export interface Response { deleted : boolean; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default DeleteArchive;
