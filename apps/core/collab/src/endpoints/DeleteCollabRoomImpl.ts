//
import { DeleteCollabRoom, Collab } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Access } from "@repo/system";

import CollabService from "../services/CollabService";

//
// Archive a room (collab-6.4/7.5) — owner-gated, or ACCOUNT/ROOT.
//
export class DeleteCollabRoomImpl extends DeleteCollabRoom
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
        if( !isOwner && !isElevated ) return { status: NetworkUtils.Status.FORBIDDEN, data: { message: "only the room owner (or an account admin) may archive this room" } };

        const archived : Type.Result<void> = await this.service.archiveRoom( auth.accountId, this.query.roomId );
        if( !archived.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "could not archive room" } };
        return { status: NetworkUtils.Status.OK, data: { archived: true } };
    }
}

export default DeleteCollabRoomImpl;
// eof
