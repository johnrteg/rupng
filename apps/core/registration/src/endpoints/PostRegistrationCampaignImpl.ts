//
import { PostRegistrationCampaign, Registration } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";
import { RegistrationDomain } from "../domain/RegistrationDomain";

//
// Create a campaign under an approved brand (registration-2.0/11.1). Same shape as the brand create: the row
// lands in DRAFT and the TCR submission is ENQUEUED, because it's an external registry call that can run far
// past a request's budget. The brand-must-be-APPROVED gate lives in the domain's `submitCampaign`, so a
// campaign drafted against a still-pending brand is created and simply waits rather than being refused.
//
export class PostRegistrationCampaignImpl extends PostRegistrationCampaign
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PostRegistrationCampaign.Body | null = this.body;
        if( !body ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "a campaign body is required" } };

        const fields : RegistrationDomain.CampaignFields = {
            brandId: body.brandId, usecase: body.usecase, subUsecases: body.subUsecases,
            description: body.description, messageFlow: body.messageFlow,
            sample1: body.sample1, sample2: body.sample2, sample3: body.sample3, sample4: body.sample4, sample5: body.sample5,
            optin: body.optin, help: body.help, optout: body.optout,
            subscriberOptin: body.subscriberOptin, subscriberOptout: body.subscriberOptout, subscriberHelp: body.subscriberHelp,
            embeddedLink: body.embeddedLink, embeddedPhone: body.embeddedPhone, numberPool: body.numberPool,
            ageGated: body.ageGated, directLending: body.directLending, affiliateMarketing: body.affiliateMarketing,
            autoRenewal: body.autoRenewal, privacyPolicyLink: body.privacyPolicyLink, termsAndConditionsLink: body.termsAndConditionsLink,
            provider: body.provider, areaCode: body.areaCode,
        };

        const created : Type.Result<Registration.Campaign> = await this.service.domain.createCampaign( auth.accountId, fields );
        if( !created.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: created.error } };

        // queue the TCR submission; an enqueue miss leaves a resubmittable DRAFT rather than losing the work
        const queued : Type.Result<string> = await this.service.domain.enqueueSubmit( {
            kind: RegistrationDomain.SubmitKind.SUBMIT, accountId: auth.accountId, campaignId: created.data.campaignId,
        } );
        if( !queued.ok ) return { status: NetworkUtils.Status.OK, data: created.data };

        return { status: NetworkUtils.Status.OK, data: created.data };
    }
}

export default PostRegistrationCampaignImpl;
// eof
