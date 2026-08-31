//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Remove a member from a room (collab-7.3) — evicts their live connection (the room server watches for this
// via Redis pub/sub and sends an `evict` frame, closing the socket).
//
export class DeleteCollabRoomMember extends RestfulEndpoint< DeleteCollabRoomMember.Query, undefined, DeleteCollabRoomMember.Response >
{
    public readonly uri      : string = DeleteCollabRoomMember.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "removeCollabRoomMember",
        summary:     "Remove a room member",
        description: "Removes a member from a room and evicts their live connection.",
        tags:        [ "Collab" ],
    };

    constructor( roomId? : string, userId? : string ) { super( { roomId: roomId ?? "", userId: userId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "roomId", location: RestfulEndpoint.AttrLocation.URI, required: true },
            { field: "userId", location: RestfulEndpoint.AttrLocation.URI, required: true },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteCollabRoomMember
{
    export const URI : string = apiPath( "collab", 1, "/rooms/:roomId/members/:userId" );
    export interface Query { roomId : string; userId : string; }
    export interface Response { removed : true; }
    export enum Error
    {
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default DeleteCollabRoomMember;
// eof
