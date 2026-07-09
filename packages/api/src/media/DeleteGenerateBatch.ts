//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

// Discard an AI-generation staging batch (media-18) — deletes every staged candidate's bytes from the staging
// bucket and removes the batch record. Nothing was ever in the library, so this just cleans up staging.
export class DeleteGenerateBatch extends RestfulEndpoint<DeleteGenerateBatch.Query, undefined, DeleteGenerateBatch.Response>
{
    public readonly uri      : string = DeleteGenerateBatch.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( batchId? : string ) { super( { batchId: batchId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "batchId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteGenerateBatch
{
    export const URI : string = apiPath( "media", 1, "/generate/:batchId" );
    export interface Query { batchId : string; }
    export interface Response { discarded : boolean; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default DeleteGenerateBatch;
