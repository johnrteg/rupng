//
import { PatchCollabRoom, Collab } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Access } from "@repo/system";

import CollabService from "../services/CollabService";

//
// Rename / change a room's visibility (collab-1.2/7.4) — owner-gated, or ACCOUNT/ROOT.
//
export class PatchCollabRoomImpl extends PatchCollabRoom
{
    private service : CollabService;
    constructor( service : CollabService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const found : Type.Result<Collab.Room | undefined> = await this.service.getRoom( auth.accountId, this.query.roomId );
        if( !found.ok || found.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "room not found" } };

        const isOwner : boolean = found.data.ownerId === auth.userId;
        const isElevated : boolean = Boolean( auth.role && Access.isAllowed( auth.role as Access.Role, Access.AccountRole.ACCOUNT ) );
        if( !isOwner && !isElevated ) return { status: NetworkUtils.Status.FORBIDDEN, data: { message: "only the room owner (or an account admin) may edit this room" } };

        const body : PatchCollabRoom.Body | null = this.body;
        const updated : Type.Result<Collab.Room> = await this.service.patchRoom( auth.accountId, this.query.roomId, { name: body?.name, visibility: body?.visibility } );
        if( !updated.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "could not update room" } };
        return { status: NetworkUtils.Status.OK, data: { room: updated.data } };
    }
}

export default PatchCollabRoomImpl;
// eof
