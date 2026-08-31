//
import { PostCollabRooms } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Collab } from "@repo/api";

import CollabService from "../services/CollabService";

//
// Create a channel room; the caller becomes owner (collab-1.2/7.2/7.4/7.5).
//
export class PostCollabRoomsImpl extends PostCollabRooms
{
    private service : CollabService;
    constructor( service : CollabService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const body : PostCollabRooms.Body | null = this.body;
        if( !body?.name || !body.visibility ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "name and visibility are required" } };

        const created : Type.Result<Collab.Room> = await this.service.createRoom( auth.accountId, auth.userId, body.name, body.visibility );
        if( !created.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "could not create room" } };
        return { status: NetworkUtils.Status.OK, data: { room: created.data } };
    }
}

export default PostCollabRoomsImpl;
// eof
