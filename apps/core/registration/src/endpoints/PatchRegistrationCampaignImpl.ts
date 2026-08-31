//
import { PatchRegistrationCampaign, Registration } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";
import { RegistrationDomain } from "../domain/RegistrationDomain";

//
// Partially update a campaign's user-submittable fields (registration-2.0/3.2 — the remediation loop's edit
// half). Same status-gate rationale as the brand PATCH: which statuses permit an edit is a domain rule.
//
export class PatchRegistrationCampaignImpl extends PatchRegistrationCampaign
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PatchRegistrationCampaign.Body | null = this.body;
        if( !body ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "an update body is required" } };

        const existing : Type.Result<Registration.Campaign | undefined> = await this.service.domain.getCampaign( auth.accountId, this.query.campaignId );
        if( !existing.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not read the campaign" } };
        if( existing.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "campaign not found" } };

        const fields : Partial<RegistrationDomain.CampaignFields> = {
            usecase: body.usecase, subUsecases: body.subUsecases,
            description: body.description, messageFlow: body.messageFlow,
            sample1: body.sample1, sample2: body.sample2, sample3: body.sample3, sample4: body.sample4, sample5: body.sample5,
            optin: body.optin, help: body.help, optout: body.optout,
            subscriberOptin: body.subscriberOptin, subscriberOptout: body.subscriberOptout, subscriberHelp: body.subscriberHelp,
            embeddedLink: body.embeddedLink, embeddedPhone: body.embeddedPhone, numberPool: body.numberPool,
            ageGated: body.ageGated, directLending: body.directLending, affiliateMarketing: body.affiliateMarketing,
            autoRenewal: body.autoRenewal, privacyPolicyLink: body.privacyPolicyLink, termsAndConditionsLink: body.termsAndConditionsLink,
            provider: body.provider, areaCode: body.areaCode,
        };

        const patched : Type.Result<Registration.Campaign> = await this.service.domain.patchCampaign( auth.accountId, this.query.campaignId, fields );
        if( !patched.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: patched.error } };
        return { status: NetworkUtils.Status.OK, data: patched.data };
    }
}

export default PatchRegistrationCampaignImpl;
// eof
