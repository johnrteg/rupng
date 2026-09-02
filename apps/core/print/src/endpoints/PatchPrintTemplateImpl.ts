//
import { PatchPrintTemplate, Print } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// Edit a print template (print-1.1) — partial update of name/schema.
//
export class PatchPrintTemplateImpl extends PatchPrintTemplate
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const body : PatchPrintTemplate.Body | null = this.body;

        const updated : Type.Result<Print.Template | undefined> = await this.service.updateTemplate( auth.accountId, this.query.id, { name: body?.name, schema: body?.schema } );
        if( !updated.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not update the template" } };
        if( updated.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "template not found" } };
        return { status: NetworkUtils.Status.OK, data: { template: updated.data } };
    }
}

export default PatchPrintTemplateImpl;
// eof
