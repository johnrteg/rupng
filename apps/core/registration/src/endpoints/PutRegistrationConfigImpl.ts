//
import { PutRegistrationConfig, RegistrationConfig } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// Set the registration service's runtime config. ROOT. The endpoint's own body schema is deliberately loose
// (a nested object); the STRICT check is `RegistrationConfig.SCHEMA`, run here — the same schema the Console's
// JSON editor lints against, so an operator can't push a config through the API that the editor would reject.
//
export class PutRegistrationConfigImpl extends PutRegistrationConfig
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PutRegistrationConfig.Body | null = this.body;
        if( !body || !RegistrationConfig.validate.is( body.config ) )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "invalid registration config" } };

        const saved : Type.Result<void> = await this.service.saveConfig( body.config );
        if( !saved.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not save config" } };
        return { status: NetworkUtils.Status.OK, data: { config: body.config } };
    }
}

export default PutRegistrationConfigImpl;
// eof
