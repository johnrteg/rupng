//
import { PostPrintCostPreview, Print } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// Preview print run cost + lead time (print-6.2/6.3).
//
export class PostPrintCostPreviewImpl extends PostPrintCostPreview
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const body : PostPrintCostPreview.Body | null = this.body;
        if( !body?.type || !body.mailClass || !body.recipients )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "type, mailClass, and recipients are required" } };

        // the session's own accountId, never a client-supplied one
        const preview : Print.CostPreviewResult = await this.service.costPreview( { ...body, accountId: auth.accountId } );
        return { status: NetworkUtils.Status.OK, data: preview };
    }
}

export default PostPrintCostPreviewImpl;
// eof
