//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Collab } from "./model/Collab";
import { Paging } from "../model/Paging";

//
// Chat history for one room (collab-3.1/6.2) — paged, ordered by `createdAt`, within the account's chat TTL
// window (older messages are auto-expired by DynamoDB and simply gone unless retention is on).
//
export class GetCollabMessages extends RestfulEndpoint< GetCollabMessages.Query, undefined, GetCollabMessages.Response >
{
    public readonly uri      : string = GetCollabMessages.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listCollabMessages",
        summary:     "List a room's chat history",
        description: "Lists a room's messages, newest last, paged, within the account's chat retention window.",
        tags:        [ "Collab" ],
    };

    constructor( roomId? : string, query? : GetCollabMessages.Query ) { super( { roomId: roomId ?? "", ...( query ?? {} ) } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "roomId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetCollabMessages
{
    export const URI : string = apiPath( "collab", 1, "/rooms/:roomId/messages" );
    export interface Query extends Paging.Request { roomId : string; }
    export interface Response extends Paging.Result<Collab.Message> {}
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default GetCollabMessages;
// eof
