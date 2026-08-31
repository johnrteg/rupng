//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Registration } from "./model/Registration";

//
// Create a campaign under an approved brand (registration-2.0/11.1) — use-case + samples + opt-in/opt-out
// copy + line/provisioning preferences. Body is the user-submittable subset of Registration.Campaign; server
// assigns campaignId once TCR accepts the submission. Starts DRAFT. ACCOUNT — campaign creation is
// consequential (billable + carrier-facing).
//
export class PostRegistrationCampaign extends RestfulEndpoint< {}, PostRegistrationCampaign.Body, PostRegistrationCampaign.Response >
{
    public readonly uri      : string = PostRegistrationCampaign.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createRegistrationCampaign",
        summary:     "Create a campaign",
        description: "Creates a campaign under an approved brand (use-case, samples, opt-in/opt-out copy, line preferences). Starts in DRAFT.",
        tags:        [ "Registration" ],
    };

    constructor( body? : PostRegistrationCampaign.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true,
            required: [ "brandId", "usecase", "description", "messageFlow", "sample1", "sample2",
                        "optin", "help", "optout", "privacyPolicyLink", "provider" ],
            properties: {
                brandId:            { type: "string", minLength: 1 },
                usecase:            { type: "string", enum: Object.values( Registration.UseCase ) },
                subUsecases:        { type: "array", items: { type: "string", enum: Object.values( Registration.UseCase ) } },
                description:        { type: "string", minLength: 40, maxLength: 4096 },
                messageFlow:        { type: "string", minLength: 40, maxLength: 4096 },
                sample1:            { type: "string", minLength: 20, maxLength: 1024 },
                sample2:            { type: "string", minLength: 20, maxLength: 1024 },
                sample3:            { type: "string" },
                sample4:            { type: "string" },
                sample5:            { type: "string" },
                optin:              { type: "object" },
                help:               { type: "object" },
                optout:             { type: "object" },
                subscriberOptin:    { type: "boolean" },
                subscriberOptout:   { type: "boolean" },
                subscriberHelp:     { type: "boolean" },
                embeddedLink:       { type: "boolean" },
                embeddedPhone:      { type: "boolean" },
                numberPool:         { type: "boolean" },
                ageGated:           { type: "boolean" },
                directLending:      { type: "boolean" },
                affiliateMarketing: { type: "boolean" },
                autoRenewal:        { type: "boolean" },
                privacyPolicyLink:  { type: "string", minLength: 1 },
                termsAndConditionsLink: { type: "string" },
                provider:           { type: "string", enum: Object.values( Registration.CarrierProvider ) },
                areaCode:           { type: "string" },
            },
        };
    }
}

export namespace PostRegistrationCampaign
{
    export const URI : string = apiPath( "registration", 1, "/campaign" );

    export interface Body extends RestfulEndpoint.AuthRequest,
        Pick<Registration.Campaign,
            "brandId" | "usecase" | "subUsecases" | "description" | "messageFlow" | "sample1" | "sample2" |
            "sample3" | "sample4" | "sample5" | "optin" | "help" | "optout" | "subscriberOptin" | "subscriberOptout" |
            "subscriberHelp" | "embeddedLink" | "embeddedPhone" | "numberPool" | "ageGated" | "directLending" |
            "affiliateMarketing" | "autoRenewal" | "privacyPolicyLink" | "termsAndConditionsLink" | "provider" | "areaCode"> {}

    export interface Response extends Registration.Campaign {}

    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,   // brand doesn't exist / isn't approved
    }
}

export default PostRegistrationCampaign;
// eof
