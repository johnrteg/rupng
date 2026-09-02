//
import { GetPrintMailpieceTracking, Print } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// A mailpiece's USPS tracking-event timeline (print-4.1).
//
export class GetPrintMailpieceTrackingImpl extends GetPrintMailpieceTracking
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const found : Type.Result<Array<Print.TrackingEvent>> = await this.service.listTracking( auth.accountId, this.query.id );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not read tracking" } };
        return { status: NetworkUtils.Status.OK, data: { events: found.data } };
    }
}

export default GetPrintMailpieceTrackingImpl;
// eof
