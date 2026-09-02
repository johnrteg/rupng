//
import { PostPrintTemplates, Print } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// Create a print template (print-1.1/3.3).
//
export class PostPrintTemplatesImpl extends PostPrintTemplates
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const body : PostPrintTemplates.Body | null = this.body;
        if( !body?.name || !body.type ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "name and type are required" } };

        // the session's own accountId, never a client-supplied one
        const created : Type.Result<Print.Template> = await this.service.createTemplate( auth.accountId, body.name, body.type, body.schema ?? {} );
        if( !created.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not create the template" } };
        return { status: NetworkUtils.Status.OK, data: { template: created.data } };
    }
}

export default PostPrintTemplatesImpl;
// eof
