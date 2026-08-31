//
import { GetVoiceDispatchState } from "@repo/api";
import type { Dispatch } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { WorkQueue } from "@repo/services";

import VoiceService from "../services/VoiceService";

//
// Voice dispatch (WorkQueue) operational state (voice-11.4 / SPECS.md gap #8). APPLICATION.
//
export class GetVoiceDispatchStateImpl extends GetVoiceDispatchState
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const raw : WorkQueue.QueueSnapshot = await this.service.workQueue.snapshot();
        const snapshot : Dispatch.QueueSnapshot =
        {
            queue: raw.queue, depth: raw.depth, lowWaterMark: raw.lowWaterMark, batchSize: raw.batchSize,
            leaseSeconds: raw.leaseSeconds, truncated: raw.truncated,
            accounts: raw.accounts.map( ( account : WorkQueue.AccountState ) : Dispatch.AccountState => ( {
                accountId: account.accountId, pending: account.pending, inflight: account.inflight,
                windows: account.windows, fairScore: account.fairScore, suspended: account.suspended,
            } ) ),
        };
        return { status: NetworkUtils.Status.OK, data: { snapshot } };
    }
}

export default GetVoiceDispatchStateImpl;
// eof
