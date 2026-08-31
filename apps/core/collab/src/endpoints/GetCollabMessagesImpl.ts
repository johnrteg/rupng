//
import { GetCollabMessages, Collab } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import CollabService from "../services/CollabService";

//
// Chat history for one room (collab-3.1/6.2) — membership-gated.
//
export class GetCollabMessagesImpl extends GetCollabMessages
{
    private service : CollabService;
    constructor( service : CollabService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const member : Type.Result<{ roomId : string; userId : string } | undefined> = await this.service.isMember( this.query.roomId, auth.userId );
        if( !member.ok || member.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "room not found" } };

        const found : Type.Result<Array<Collab.Message>> = await this.service.listMessages( this.query.roomId, this.query.count ?? 50 );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not list messages" } };
        return { status: NetworkUtils.Status.OK, data: { records: found.data, page: { count: found.data.length, total: found.data.length } } };
    }
}

export default GetCollabMessagesImpl;
// eof
