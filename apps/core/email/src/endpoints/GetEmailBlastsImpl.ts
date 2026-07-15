//
import { GetEmailBlasts, Email } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import EmailService from "../services/EmailService";

//
// List the account's blasts (email-1.9), optionally filtered by status — newest first.
//
export class GetEmailBlastsImpl extends GetEmailBlasts
{
    private service : EmailService;
    constructor( service : EmailService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found : Type.Result<Array<Email.Blast>> = await this.service.listBlasts( auth.accountId );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "blast read failed" } };

        const status : Email.BlastStatus | undefined = this.query?.status;
        const records : Array<Email.Blast> = found.data
            .filter( ( blast : Email.Blast ) : boolean => !status || blast.status === status )
            .sort( ( first : Email.Blast, second : Email.Blast ) : number => String( second.createdAt ).localeCompare( String( first.createdAt ) ) );

        return { status: NetworkUtils.Status.OK, data: { records } };
    }
}

export default GetEmailBlastsImpl;
