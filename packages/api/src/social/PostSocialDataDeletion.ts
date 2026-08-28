//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Meta's Data Deletion Request callback (app-authorized users only — Meta has no per-commenter forget
// signal; see SPECS.md §6.4.4). Signature-verified (the `signed_request` field, HMAC-SHA256 with the
// app secret), not RBAC. Meta requires the response to carry a confirmation URL + code the user can
// check status at.
//
export class PostSocialDataDeletion extends RestfulEndpoint< {}, PostSocialDataDeletion.Body, PostSocialDataDeletion.Response >
{
    public readonly uri      : string = PostSocialDataDeletion.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // signature-verified, not RBAC
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    constructor( body? : PostSocialDataDeletion.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    { return { type: "object", additionalProperties: false, required: [ "signed_request" ], properties: { signed_request: { type: "string" } } }; }
}

export namespace PostSocialDataDeletion
{
    export const URI : string = apiPath( "social", 1, "/data-deletion/meta" );

    export interface Body extends RestfulEndpoint.NonAuthRequest { signed_request : string; }
    export interface Response { url : string; confirmation_code : string; }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostSocialDataDeletion;
