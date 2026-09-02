//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { PhoneNumber } from "./model/PhoneNumber";

//
// Staff-progressed short-code application status update (registration-4.x) — there is no carrier webhook to
// drive this (no vendor exposes a self-serve short-code order api), so a human on the sales/ops side advances
// SUBMITTED -> CARRIER_REVIEW -> ACTIVE|REJECTED as the real, external process moves. ROOT only (mirrors
// PostRegistrationOverride's staff break-glass gate).
//
export class PatchRegistrationShortCodeApplication extends RestfulEndpoint< PatchRegistrationShortCodeApplication.Query, PatchRegistrationShortCodeApplication.Body, PatchRegistrationShortCodeApplication.Response >
{
    public readonly uri      : string = PatchRegistrationShortCodeApplication.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "updateRegistrationShortCodeApplication",
        summary:     "Progress a short-code application (staff)",
        description: "Manually advances a short-code application's status as the external carrier process moves. Staff only.",
        tags:        [ "Registration" ],
    };

    constructor( id? : string, body? : PatchRegistrationShortCodeApplication.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "status" ],
            properties: {
                status:     { type: "string", enum: Object.values( PhoneNumber.ShortCodeStatus ) },
                shortCode:  { type: "string" },
                staffNote:  { type: "string" },
            },
        };
    }
}

export namespace PatchRegistrationShortCodeApplication
{
    export const URI : string = apiPath( "registration", 1, "/shortcode/:id" );
    export interface Query { id : string; }

    export interface Body extends RestfulEndpoint.AuthRequest
    {
        status     : PhoneNumber.ShortCodeStatus;
        shortCode? : string;
        staffNote? : string;
    }

    export interface Response extends PhoneNumber.ShortCodeApplication {}

    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PatchRegistrationShortCodeApplication;
// eof
