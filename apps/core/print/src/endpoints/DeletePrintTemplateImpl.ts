//
import { DeletePrintTemplate } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// Archive (soft-delete) a print template (print-1.1).
//
export class DeletePrintTemplateImpl extends DeletePrintTemplate
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const archived : Type.Result<boolean> = await this.service.archiveTemplate( auth.accountId, this.query.id );
        if( !archived.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not archive the template" } };
        if( !archived.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "template not found" } };
        return { status: NetworkUtils.Status.OK, data: { archived: true } };
    }
}

export default DeletePrintTemplateImpl;
// eof
