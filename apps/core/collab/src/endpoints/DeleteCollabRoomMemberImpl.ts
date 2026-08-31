//
import { DeleteCollabRoomMember, Collab } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import CollabService from "../services/CollabService";

//
// Remove a member from a room (collab-7.3) — evicts their live connection via a Redis-published `evict`
// event; every `CollabRoomServer` instance holding a local socket for this room closes it if it belongs to
// this user.
//
export class DeleteCollabRoomMemberImpl extends DeleteCollabRoomMember
{
    private service : CollabService;
    constructor( service : CollabService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const found : Type.Result<Collab.Room | undefined> = await this.service.getRoom( auth.accountId, this.query.roomId );
        if( !found.ok || found.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "room not found" } };

        const removed : Type.Result<void> = await this.service.removeMember( this.query.roomId, this.query.userId );
        if( !removed.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "could not remove member" } };
        await this.service.publishRoomEvent( this.query.roomId, { kind: "evict", userId: this.query.userId } );
        return { status: NetworkUtils.Status.OK, data: { removed: true } };
    }
}

export default DeleteCollabRoomMemberImpl;
// eof
