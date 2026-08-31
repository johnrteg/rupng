//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Collab } from "./model/Collab";

//
// Invite a member to a room (collab-7.2/7.4) — required for PRIVATE rooms; a PUBLIC room admits any owning-
// account user without an invite (this endpoint is only needed there to add an outside-account guest, which
// needs ACCOUNT — enforced in the impl, not the schema).
//
export class PostCollabRoomMembers extends RestfulEndpoint< PostCollabRoomMembers.Query, PostCollabRoomMembers.Body, PostCollabRoomMembers.Response >
{
    public readonly uri      : string = PostCollabRoomMembers.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "inviteCollabRoomMember",
        summary:     "Invite a room member",
        description: "Invites a user to a private room (or an outside-account guest, which needs ACCOUNT).",
        tags:        [ "Collab" ],
    };

    constructor( roomId? : string, body? : PostCollabRoomMembers.Body ) { super( { roomId: roomId ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "roomId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, required: [ "userId" ], properties: { userId: { type: "string" } } };
    }
}

export namespace PostCollabRoomMembers
{
    export const URI : string = apiPath( "collab", 1, "/rooms/:roomId/members" );
    export interface Query { roomId : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { userId : string; }
    export interface Response { room : Collab.Room; }
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PostCollabRoomMembers;
// eof
