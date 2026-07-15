//
import { GetEmailConfig, EmailConfig } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import EmailService from "../services/EmailService";

//
// Read the email service's runtime config (email-11.2) — ROOT. Returns the live AppConfig value (deep-filled
// from DEFAULT).
//
export class GetEmailConfigImpl extends GetEmailConfig
{
    private service : EmailService;
    constructor( service : EmailService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const config : EmailConfig.Config = await this.service.emailConfig();
        return { status: NetworkUtils.Status.OK, data: { config } };
    }
}

export default GetEmailConfigImpl;
