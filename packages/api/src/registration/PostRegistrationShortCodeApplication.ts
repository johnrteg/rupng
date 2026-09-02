//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { PhoneNumber } from "./model/PhoneNumber";

//
// Submit a short-code request (registration-4.x). No carrier exposes a self-serve short-code ORDER api
// (verified — Telnyx/Bandwidth/Vonage all require sales/ops-mediated applications + 8-12+ week carrier
// certification), so this lands a SUBMITTED application record for staff to progress
// (PatchRegistrationShortCodeApplication), not an instant order. ACCOUNT.
//
export class PostRegistrationShortCodeApplication extends RestfulEndpoint< {}, PostRegistrationShortCodeApplication.Body, PostRegistrationShortCodeApplication.Response >
{
    public readonly uri      : string = PostRegistrationShortCodeApplication.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createRegistrationShortCodeApplication",
        summary:     "Request a short code",
        description: "Submits a short-code request (vanity or random). Lands SUBMITTED; a carrier application is a sales/ops-mediated, weeks-long process staff progress manually.",
        tags:        [ "Registration" ],
    };

    constructor( body? : PostRegistrationShortCodeApplication.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "preference", "useCase" ],
            properties: {
                preference: { type: "string", enum: Object.values( PhoneNumber.ShortCodePreference ) },
                vanityCode: { type: "string" },
                useCase:    { type: "string", minLength: 1 },
                campaignId: { type: "string" },
            },
        };
    }
}

export namespace PostRegistrationShortCodeApplication
{
    export const URI : string = apiPath( "registration", 1, "/shortcode" );

    export interface Body extends RestfulEndpoint.AuthRequest
    {
        preference  : PhoneNumber.ShortCodePreference;
        vanityCode? : string;
        useCase     : string;
        campaignId? : string;
    }

    export interface Response extends PhoneNumber.ShortCodeApplication {}

    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
    }
}

export default PostRegistrationShortCodeApplication;
// eof
