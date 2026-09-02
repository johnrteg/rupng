//
import { GetTextingLog, Texting } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import TextingService from "../services/TextingService";

//
// List the account's send-log rows (texting-11.1), optionally filtered by status — newest first.
//
export class GetTextingLogImpl extends GetTextingLog
{
    private service : TextingService;
    constructor( service : TextingService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found : Type.Result<Array<Texting.Message>> = await this.service.listLog( auth.accountId );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "send log read failed" } };

        const status : Texting.DeliveryStatus | undefined = this.query?.status;
        const records : Array<Texting.Message> = found.data
            .filter( ( row : Texting.Message ) : boolean => !status || row.status === status )
            .sort( ( first : Texting.Message, second : Texting.Message ) : number => String( second.createdAt ).localeCompare( String( first.createdAt ) ) );

        return { status: NetworkUtils.Status.OK, data: { records } };
    }
}

export default GetTextingLogImpl;
// eof
