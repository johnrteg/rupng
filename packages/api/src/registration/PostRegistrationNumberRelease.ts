//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { PhoneNumber } from "./model/PhoneNumber";

//
// Release an owned number back to the carrier (registration-4.x) — idempotent; releasing an already-released
// number succeeds without erroring. ACCOUNT — a consequential, billable-impacting action.
//
export class PostRegistrationNumberRelease extends RestfulEndpoint< {}, PostRegistrationNumberRelease.Body, PostRegistrationNumberRelease.Response >
{
    public readonly uri      : string = PostRegistrationNumberRelease.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "releaseRegistrationNumber",
        summary:     "Release a number",
        description: "Releases an owned number back to the carrier. Idempotent.",
        tags:        [ "Registration" ],
    };

    constructor( body? : PostRegistrationNumberRelease.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, required: [ "id" ], properties: { id: { type: "string", minLength: 1 } } };
    }
}

export namespace PostRegistrationNumberRelease
{
    export const URI : string = apiPath( "registration", 1, "/number/release" );
    export interface Body extends RestfulEndpoint.AuthRequest { id : string; }
    export interface Response extends PhoneNumber.PhoneNumber {}
    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PostRegistrationNumberRelease;
// eof
