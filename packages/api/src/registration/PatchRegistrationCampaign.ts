//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Registration } from "./model/Registration";
import { Texting } from "../texting/model/Texting";

//
// Partially update a campaign's user-submittable fields (registration-2.0/3.2 remediation loop). Same
// submittable subset as PostRegistrationCampaign, all optional; the impl enforces which statuses allow an edit.
//
export class PatchRegistrationCampaign extends RestfulEndpoint< PatchRegistrationCampaign.Query, PatchRegistrationCampaign.Body, PatchRegistrationCampaign.Response >
{
    public readonly uri      : string = PatchRegistrationCampaign.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "updateRegistrationCampaign",
        summary:     "Update a campaign",
        description: "Partially updates a campaign's user-submittable fields.",
        tags:        [ "Registration" ],
    };

    constructor( campaignId? : string, body? : PatchRegistrationCampaign.Body ) { super( { campaignId: campaignId ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "campaignId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true,
            properties: {
                usecase:            { type: "string", enum: Object.values( Registration.UseCase ) },
                subUsecases:        { type: "array", items: { type: "string", enum: Object.values( Registration.UseCase ) } },
                description:        { type: "string" },
                messageFlow:        { type: "string" },
                sample1:            { type: "string" },
                sample2:            { type: "string" },
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
                privacyPolicyLink:  { type: "string" },
                termsAndConditionsLink: { type: "string" },
                provider:           { type: "string", enum: Object.values( Registration.CarrierProvider ) },
                areaCode:           { type: "string" },
                numberSelection:    {
                    type: "object", additionalProperties: false, required: [ "mode" ],
                    properties: {
                        mode:     { type: "string", enum: Object.values( Texting.NumberSelectionMode ) },
                        number:   { type: "string" },
                        areaCode: { type: "string" },
                    },
                },
            },
        };
    }
}

export namespace PatchRegistrationCampaign
{
    export const URI : string = apiPath( "registration", 1, "/campaign/:campaignId" );
    export interface Query { campaignId : string; }

    export interface Body extends RestfulEndpoint.AuthRequest,
        Partial<Pick<Registration.Campaign,
            "usecase" | "subUsecases" | "description" | "messageFlow" | "sample1" | "sample2" |
            "sample3" | "sample4" | "sample5" | "optin" | "help" | "optout" | "subscriberOptin" | "subscriberOptout" |
            "subscriberHelp" | "embeddedLink" | "embeddedPhone" | "numberPool" | "ageGated" | "directLending" |
            "affiliateMarketing" | "autoRenewal" | "privacyPolicyLink" | "termsAndConditionsLink" | "provider" | "areaCode" | "numberSelection">> {}

    export interface Response extends Registration.Campaign {}

    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PatchRegistrationCampaign;
// eof
