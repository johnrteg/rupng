//
import { PostCollabDms, Collab } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import CollabService from "../services/CollabService";

//
// Find-or-create a 1:1 DM room (collab-1.2).
//
export class PostCollabDmsImpl extends PostCollabDms
{
    private service : CollabService;
    constructor( service : CollabService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const body : PostCollabDms.Body | null = this.body;
        if( !body?.userId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "userId is required" } };
        if( body.userId === auth.userId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "cannot DM yourself" } };

        const room : Type.Result<Collab.Room> = await this.service.findOrCreateDm( auth.accountId, auth.userId, body.userId );
        if( !room.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "could not open DM" } };
        return { status: NetworkUtils.Status.OK, data: { room: room.data } };
    }
}

export default PostCollabDmsImpl;
// eof
