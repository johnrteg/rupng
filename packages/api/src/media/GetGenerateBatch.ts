//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { AiGen } from "../ai/model/AiGen";

// Poll an AI-generation staging batch (media-18) — the candidates with their per-item status + a (signed)
// preview URL once each is READY. Candidates live in the staging bucket, NOT the library, until promoted.
export class GetGenerateBatch extends RestfulEndpoint<GetGenerateBatch.Query, undefined, GetGenerateBatch.Response>
{
    public readonly uri      : string = GetGenerateBatch.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( batchId? : string ) { super( { batchId: batchId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "batchId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetGenerateBatch
{
    export const URI : string = apiPath( "media", 1, "/generate/:batchId" );
    export interface Query { batchId : string; }
    export interface Response { batch : AiGen.Batch; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetGenerateBatch;
