//
import { GetEmailTemplates, EmailTemplate } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import EmailService from "../services/EmailService";

//
// List the account's templates + the platform SYSTEM templates (email-2.1), filtered by scope / notification
// type / status. Merges the two partitions so the editor sees both account + system cases.
//
export class GetEmailTemplatesImpl extends GetEmailTemplates
{
    private service : EmailService;
    constructor( service : EmailService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        // account templates + the shared SYSTEM partition
        const own : Type.Result<Array<EmailTemplate.Entity>> = await this.service.listTemplates( auth.accountId );
        const system : Type.Result<Array<EmailTemplate.Entity>> = await this.service.listTemplates( EmailService.SYSTEM_ACCOUNT );
        if( !own.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "template read failed" } };

        // apply the query filters (scope / notificationType / status)
        const query : GetEmailTemplates.Query = this.query ?? {};
        const merged : Array<EmailTemplate.Entity> = [ ...own.data, ...( system.ok ? system.data : [] ) ]
            .filter( ( template : EmailTemplate.Entity ) : boolean =>
                ( !query.scope            || template.scope            === query.scope )
                && ( !query.notificationType || template.notificationType === query.notificationType )
                && ( !query.status           || template.status           === query.status ) );

        return { status: NetworkUtils.Status.OK, data: { records: merged } };
    }
}

export default GetEmailTemplatesImpl;
