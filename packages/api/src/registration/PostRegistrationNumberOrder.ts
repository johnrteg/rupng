//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Texting } from "../texting/model/Texting";
import { Registration } from "./model/Registration";
import { PhoneNumber } from "./model/PhoneNumber";

//
// Order ONE specific, previously-searched number (registration-4.x) — a real carrier order, so ACCOUNT access
// (mirrors PostRegistrationCampaign's "consequential + billable" posture). A LONG_CODE order REQUIRES an
// already-APPROVED `campaignId` to bind to (the domain enforces this, not just the schema); TOLL_FREE needs
// none. Returns immediately with `status: PENDING` when the carrier confirms asynchronously.
//
export class PostRegistrationNumberOrder extends RestfulEndpoint< {}, PostRegistrationNumberOrder.Body, PostRegistrationNumberOrder.Response >
{
    public readonly uri      : string = PostRegistrationNumberOrder.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "orderRegistrationNumber",
        summary:     "Order a number",
        description: "Orders one specific number returned by a prior search. A long-code order requires an approved campaignId.",
        tags:        [ "Registration" ],
    };

    constructor( body? : PostRegistrationNumberOrder.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "number", "numberType", "carrier" ],
            properties: {
                number:     { type: "string", minLength: 1 },
                numberType: { type: "string", enum: [ Texting.NumberType.LONG_CODE, Texting.NumberType.TOLL_FREE ] },
                carrier:    { type: "string", enum: Object.values( Registration.CarrierProvider ) },
                campaignId: { type: "string" },
            },
        };
    }
}

export namespace PostRegistrationNumberOrder
{
    export const URI : string = apiPath( "registration", 1, "/number/order" );

    export interface Body extends RestfulEndpoint.AuthRequest
    {
        number     : string;
        numberType : Texting.NumberType;
        carrier    : Registration.CarrierProvider;
        campaignId? : string;
    }

    export interface Response extends PhoneNumber.PhoneNumber {}

    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,   // campaignId doesn't exist / isn't approved
    }
}

export default PostRegistrationNumberOrder;
// eof
