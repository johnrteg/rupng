//
import { GetSocialConfig, SocialConfig } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SocialService from "../services/SocialService";

//
// Read the social service's runtime config — ROOT. Returns the live AppConfig value (deep-filled
// from DEFAULT).
//
export class GetSocialConfigImpl extends GetSocialConfig
{
    private service : SocialService;
    constructor( service : SocialService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const config : SocialConfig.Config = await this.service.socialConfig();
        return { status: NetworkUtils.Status.OK, data: { config } };
    }
}

export default GetSocialConfigImpl;
