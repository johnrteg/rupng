//
import { GetRegistrationConfig, RegistrationConfig } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// Read the registration service's runtime config (CSP identity, carrier-provider registry, fee tables, line
// caps, poll-sweep cadence). ROOT — a platform-operator surface. The config never carries a credential VALUE,
// only the `secretRef` that names one, so this is safe to return whole.
//
export class GetRegistrationConfigImpl extends GetRegistrationConfig
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const config : RegistrationConfig.Config = await this.service.registrationConfig();
        return { status: NetworkUtils.Status.OK, data: { config } };
    }
}

export default GetRegistrationConfigImpl;
// eof
