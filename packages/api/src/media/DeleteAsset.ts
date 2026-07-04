//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

// Soft-delete an asset (status DELETED + deletedAt); a lifecycle sweep purges the bytes later (media-1.4).
export class DeleteAsset extends RestfulEndpoint<DeleteAsset.Query, undefined, DeleteAsset.Response>
{
    public readonly uri      : string = DeleteAsset.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( guid? : string ) { super( { guid: guid ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "guid", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteAsset
{
    export const URI : string = apiPath( "media", 1, "/assets/:guid" );
    export interface Query { guid : string; }
    export interface Response { deleted : boolean; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, CONFLICT = NetworkUtils.Status.CONFLICT, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default DeleteAsset;
