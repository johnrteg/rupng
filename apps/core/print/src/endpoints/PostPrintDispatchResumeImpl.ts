//
import { PostPrintDispatchResume } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// Resume an account's print dispatch (print-9.4). APPLICATION.
//
export class PostPrintDispatchResumeImpl extends PostPrintDispatchResume
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const body : PostPrintDispatchResume.Body | null = this.body;
        if( !body?.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId is required" } };

        await this.service.workQueue.resume( body.accountId );
        return { status: NetworkUtils.Status.OK, data: { resumed: true } };
    }
}

export default PostPrintDispatchResumeImpl;
// eof
