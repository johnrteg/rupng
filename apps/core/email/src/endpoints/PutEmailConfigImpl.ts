//
import { PutEmailConfig, EmailConfig } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import EmailService from "../services/EmailService";

//
// Set the email service's runtime config (email-11.2) — ROOT. Validates against EmailConfig.SCHEMA, then
// persists a new AppConfig version + deploys it.
//
export class PutEmailConfigImpl extends PutEmailConfig
{
    private service : EmailService;
    constructor( service : EmailService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const config : EmailConfig.Config | undefined = this.body?.config;
        if( !config ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "config is required" } };

        // strict schema validation before persisting (enum check: providers must be defined Email.Provider values)
        if( !EmailConfig.validate( config ) ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "invalid email config" } };

        // semantic check: the chosen default + system providers must have a usable adapter (beyond enum membership)
        if( !this.service.hasProviderAdapter( config.defaultProvider ) ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: `no adapter for default provider "${ config.defaultProvider }"` } };
        if( !this.service.hasProviderAdapter( config.systemProvider ) )  return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: `no adapter for system provider "${ config.systemProvider }"` } };

        const saved : Type.Result<void> = await this.service.saveConfig( config );
        if( !saved.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not save the config" } };

        return { status: NetworkUtils.Status.OK, data: { config } };
    }
}

export default PutEmailConfigImpl;
