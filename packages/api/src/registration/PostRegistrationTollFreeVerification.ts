//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { PhoneNumber } from "./model/PhoneNumber";

//
// Submit toll-free verification (TFV) for an owned toll-free number (registration-4.x) — the business
// attestation ALL THREE carriers' real TFV APIs require. Async: lands SUBMITTED here, resolves to
// VERIFIED/REJECTED via webhook or the poll sweep. ACCOUNT — a real, billable-adjacent carrier submission.
//
export class PostRegistrationTollFreeVerification extends RestfulEndpoint< {}, PostRegistrationTollFreeVerification.Body, PostRegistrationTollFreeVerification.Response >
{
    public readonly uri      : string = PostRegistrationTollFreeVerification.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "submitRegistrationTollFreeVerification",
        summary:     "Submit toll-free verification",
        description: "Submits the business-attestation details for an owned toll-free number's carrier TFV review.",
        tags:        [ "Registration" ],
    };

    constructor( body? : PostRegistrationTollFreeVerification.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false,
            required: [ "id", "businessName", "businessWebsite", "useCase", "optInWorkflow", "monthlyVolume" ],
            properties: {
                id:              { type: "string", minLength: 1 },
                businessName:    { type: "string", minLength: 1 },
                businessWebsite: { type: "string", minLength: 1 },
                useCase:         { type: "string", minLength: 1 },
                optInWorkflow:   { type: "string", minLength: 1 },
                monthlyVolume:   { type: "number", minimum: 0 },
            },
        };
    }
}

export namespace PostRegistrationTollFreeVerification
{
    export const URI : string = apiPath( "registration", 1, "/number/tfv" );

    export interface Body extends RestfulEndpoint.AuthRequest
    {
        id              : string;   // the PhoneNumber.id being verified
        businessName    : string;
        businessWebsite : string;
        useCase         : string;
        optInWorkflow   : string;
        monthlyVolume   : number;
    }

    export interface Response extends PhoneNumber.PhoneNumber {}

    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PostRegistrationTollFreeVerification;
// eof
