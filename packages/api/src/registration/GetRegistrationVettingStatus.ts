//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Registration } from "./model/Registration";

//
// Read brand + campaign vetting state (registration-11.2) — the reconciled projection's identity/vetting/trust
// score fields, plus each of the brand's campaigns' operations status. Read-only; does not trigger a refresh
// (see PostRegistrationVettingRefresh for that).
//
export class GetRegistrationVettingStatus extends RestfulEndpoint< GetRegistrationVettingStatus.Query, undefined, GetRegistrationVettingStatus.Response >
{
    public readonly uri      : string = GetRegistrationVettingStatus.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getRegistrationVettingStatus",
        summary:     "Get brand + campaign vetting status",
        description: "Reads a brand's vetting/trust-score state plus its campaigns' per-carrier operations status (the reconciled projection).",
        tags:        [ "Registration" ],
    };

    constructor( brandId? : string ) { super( { brandId: brandId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "brandId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetRegistrationVettingStatus
{
    export const URI : string = apiPath( "registration", 1, "/brand/:brandId/vetting" );
    export interface Query { brandId : string; }

    /** A campaign's reconciled per-carrier operations status, surfaced alongside the brand's vetting state. */
    export interface CampaignVettingState
    {
        campaignId       : string;
        status           : Registration.CampaignStatus;
        operationsStatus? : Registration.OperationsStatus;
    }

    export interface Response
    {
        brandId          : string;
        status           : Registration.BrandStatus;
        identityStatus?  : string;
        vettingProvider? : Registration.VettingProvider;
        vettingClass?    : string;
        vettingScore?    : number;
        cvStatus?        : string;
        campaigns        : Array<CampaignVettingState>;
    }

    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default GetRegistrationVettingStatus;
// eof
