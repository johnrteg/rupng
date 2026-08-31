//
import { PostCollabRoomMembers, Collab } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import CollabService from "../services/CollabService";

//
// Invite a member to a room (collab-7.2/7.4). v1 SIMPLIFICATION: does not distinguish an outside-account
// guest from an owning-account user (SPECS.md's "outside guest needs ACCOUNT" nuance is a deferred gap — any
// authenticated user id may be invited today).
//
export class PostCollabRoomMembersImpl extends PostCollabRoomMembers
{
    private service : CollabService;
    constructor( service : CollabService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const found : Type.Result<Collab.Room | undefined> = await this.service.getRoom( auth.accountId, this.query.roomId );
        if( !found.ok || found.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "room not found" } };

        const body : PostCollabRoomMembers.Body | null = this.body;
        if( !body?.userId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "userId is required" } };

        const added : Type.Result<void> = await this.service.addMember( this.query.roomId, body.userId );
        if( !added.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "could not add member" } };
        return { status: NetworkUtils.Status.OK, data: { room: found.data } };
    }
}

export default PostCollabRoomMembersImpl;
// eof
