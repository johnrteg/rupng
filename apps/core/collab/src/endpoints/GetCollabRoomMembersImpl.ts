//
import { GetCollabRoomMembers, Collab } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import CollabService from "../services/CollabService";

//
// List a room's members + their live presence (collab-7.1).
//
export class GetCollabRoomMembersImpl extends GetCollabRoomMembers
{
    private service : CollabService;
    constructor( service : CollabService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const found : Type.Result<Collab.Room | undefined> = await this.service.getRoom( auth.accountId, this.query.roomId );
        if( !found.ok || found.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "room not found" } };

        const memberIds : Type.Result<Array<{ userId : string }>> = await this.service.listMemberIds( this.query.roomId );
        if( !memberIds.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not list members" } };

        const members : Array<Collab.PresenceEntry> = [];
        for( const row of memberIds.data ) members.push( await this.service.presenceOf( auth.accountId, row.userId ) );
        return { status: NetworkUtils.Status.OK, data: { members } };
    }
}

export default GetCollabRoomMembersImpl;
// eof
