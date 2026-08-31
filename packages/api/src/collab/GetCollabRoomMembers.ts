//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Collab } from "./model/Collab";

//
// List a room's members + their live presence (collab-7.1).
//
export class GetCollabRoomMembers extends RestfulEndpoint< GetCollabRoomMembers.Query, undefined, GetCollabRoomMembers.Response >
{
    public readonly uri      : string = GetCollabRoomMembers.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listCollabRoomMembers",
        summary:     "List a room's members",
        description: "Lists a room's members and their live presence status.",
        tags:        [ "Collab" ],
    };

    constructor( roomId? : string ) { super( { roomId: roomId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "roomId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetCollabRoomMembers
{
    export const URI : string = apiPath( "collab", 1, "/rooms/:roomId/members" );
    export interface Query { roomId : string; }
    export interface Response { members : Array<Collab.PresenceEntry>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default GetCollabRoomMembers;
// eof
