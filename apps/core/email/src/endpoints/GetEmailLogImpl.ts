//
import { GetEmailLog, Email } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import EmailService from "../services/EmailService";

//
// List the account's send-log rows (email-8.1), optionally filtered by status — newest first.
//
export class GetEmailLogImpl extends GetEmailLog
{
    private service : EmailService;
    constructor( service : EmailService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found : Type.Result<Array<Email.SendLog>> = await this.service.listLog( auth.accountId );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "send log read failed" } };

        const status : Email.Status | undefined = this.query?.status;
        const records : Array<Email.SendLog> = found.data
            .filter( ( row : Email.SendLog ) : boolean => !status || row.status === status )
            .sort( ( first : Email.SendLog, second : Email.SendLog ) : number => String( second.createdAt ).localeCompare( String( first.createdAt ) ) );

        return { status: NetworkUtils.Status.OK, data: { records } };
    }
}

export default GetEmailLogImpl;
