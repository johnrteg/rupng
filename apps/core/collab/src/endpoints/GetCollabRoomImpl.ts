//
import { GetCollabRoom, Collab } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import CollabService from "../services/CollabService";

//
// Get one room's metadata (collab-7.1/7.5). Membership-gated: only a member may read a private room; a public
// room is readable by any user of the owning account.
//
export class GetCollabRoomImpl extends GetCollabRoom
{
    private service : CollabService;
    constructor( service : CollabService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const found : Type.Result<Collab.Room | undefined> = await this.service.getRoom( auth.accountId, this.query.roomId );
        if( !found.ok || found.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "room not found" } };

        if( found.data.visibility === Collab.Visibility.PRIVATE )
        {
            const member : Type.Result<{ roomId : string; userId : string } | undefined> = await this.service.isMember( found.data.roomId, auth.userId );
            if( !member.ok || member.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "room not found" } };
        }
        return { status: NetworkUtils.Status.OK, data: { room: found.data } };
    }
}

export default GetCollabRoomImpl;
// eof
