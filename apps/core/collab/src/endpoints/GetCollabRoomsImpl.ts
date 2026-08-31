//
import { GetCollabRooms, Collab } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import CollabService from "../services/CollabService";

//
// List rooms the caller can access (collab-7.1/7.4). v1: unpaged internally (in-memory), wrapped in the
// standard paging envelope so the contract is future-proof once room counts justify a real cursor.
//
export class GetCollabRoomsImpl extends GetCollabRooms
{
    private service : CollabService;
    constructor( service : CollabService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const found : Type.Result<Array<Collab.Room>> = await this.service.listRoomsForUser( auth.accountId, auth.userId );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not list rooms" } };
        return { status: NetworkUtils.Status.OK, data: { records: found.data, page: { count: found.data.length, total: found.data.length } } };
    }
}

export default GetCollabRoomsImpl;
// eof
