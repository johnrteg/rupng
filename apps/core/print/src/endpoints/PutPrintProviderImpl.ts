//
import { PutPrintProvider, PrintConfig, Print } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// Configure one entry in EITHER the mail-fulfillment provider factory or the AddressVerifier factory
// (print-3.1/2.6) — `kind` selects which registry `id` resolves against. APPLICATION.
//
export class PutPrintProviderImpl extends PutPrintProvider
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const body : PutPrintProvider.Body | null = this.body;
        if( !body ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "enabled is required" } };

        const config : PrintConfig.Config = await this.service.printConfig();
        const id : string = this.query.id;

        if( this.query.kind === "verifier" )
        {
            if( !( Object.values( Print.AddressVerifierId ) as Array<string> ).includes( id ) )
                return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "unknown address-verifier source" } };
            const entry : PrintConfig.VerifierEntry = { verifier: id as Print.AddressVerifierId, enabled: body.enabled, secretRef: body.secretRef, capabilities: ( body.capabilities as Array<Print.Capability> | undefined ) ?? [] };
            const next : PrintConfig.Config = { ...config, addressVerifiers: { ...config.addressVerifiers, [ id ]: entry } };
            const saved : Type.Result<void> = await this.service.saveConfig( next );
            if( !saved.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not save config" } };
            return { status: NetworkUtils.Status.OK, data: { provider: entry } };
        }

        if( !( Object.values( Print.Provider ) as Array<string> ).includes( id ) )
            return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "unknown provider" } };
        const entry : PrintConfig.ProviderEntry = { provider: id as Print.Provider, enabled: body.enabled, secretRef: body.secretRef };
        const next : PrintConfig.Config = { ...config, providers: { ...config.providers, [ id ]: entry } };
        const saved : Type.Result<void> = await this.service.saveConfig( next );
        if( !saved.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not save config" } };
        return { status: NetworkUtils.Status.OK, data: { provider: entry } };
    }
}

export default PutPrintProviderImpl;
// eof
