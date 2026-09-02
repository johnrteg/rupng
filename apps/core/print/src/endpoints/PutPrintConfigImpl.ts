//
import { PutPrintConfig, PrintConfig } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// Set the print service's runtime config. ROOT. Validates against PrintConfig.SCHEMA before persisting.
//
export class PutPrintConfigImpl extends PutPrintConfig
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const body : PutPrintConfig.Body | null = this.body;
        if( !body || !PrintConfig.validate.is( body ) )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "invalid print config" } };

        const saved : Type.Result<void> = await this.service.saveConfig( body );
        if( !saved.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not save config" } };
        return { status: NetworkUtils.Status.OK, data: { config: body } };
    }
}

export default PutPrintConfigImpl;
// eof
