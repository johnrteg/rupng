//
import { PostRegistrationReprovision, Registration } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// Re-associate/re-provision numbers to a campaign (registration-11.5) — after a release, a provider switch,
// or a failed association. ASYNC: it is one or more external carrier calls, so this enqueues and returns 202.
//
export class PostRegistrationReprovisionImpl extends PostRegistrationReprovision
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        // the body's `provider` is a loose string on the wire; only a value in the closed carrier set is
        // honoured, so a typo falls back to the campaign's own provider rather than silently switching
        const requested : string | undefined = this.body?.provider;
        const provider : Registration.CarrierProvider | undefined =
            Object.values( Registration.CarrierProvider ).find( ( known : Registration.CarrierProvider ) : boolean => known === requested );

        const queued : Type.Result<string> = await this.service.domain.reprovision( auth.accountId, this.query.campaignId, provider, this.body?.areaCode );
        if( !queued.ok ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: queued.error } };
        return { status: NetworkUtils.Status.ACCEPTED, data: { queued: true, jobId: queued.data } };
    }
}

export default PostRegistrationReprovisionImpl;
// eof
