//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

// Delete an SVG library asset the caller's ACCOUNT owns (its markup in S3 + the row). System-wide assets
// aren't deletable through this endpoint — they're root/platform-managed.
export class DeleteSvgAsset extends RestfulEndpoint<DeleteSvgAsset.Query, undefined, DeleteSvgAsset.Response>
{
    public readonly uri      : string = DeleteSvgAsset.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( assetId? : string ) { super( { assetId: assetId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "assetId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteSvgAsset
{
    export const URI : string = apiPath( "media", 1, "/svg/assets/:assetId" );
    export interface Query { assetId : string; }
    export interface Response { deleted : boolean; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default DeleteSvgAsset;
