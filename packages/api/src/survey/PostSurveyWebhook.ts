//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Inbound external-provider completion webhook (SurveyMonkey/Typeform/... via marketplace, survey-2.3/6.0).
// Signature-verified in the impl (per-provider verify, mirrors PostSocialWebhook), not RBAC — hence no
// `access` role. ACK-fast: ok:true means "queued for SurveyIngestJob to normalize", not "processed".
//
export class PostSurveyWebhook extends RestfulEndpoint< PostSurveyWebhook.Query, PostSurveyWebhook.Body, PostSurveyWebhook.Response >
{
    public readonly uri      : string = PostSurveyWebhook.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // signature-verified, not RBAC
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;   // internet-reachable (the provider calls in)

    constructor( provider? : string, body? : PostSurveyWebhook.Body ) { super( { provider: provider ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [
        { field: "provider", location: RestfulEndpoint.AttrLocation.URI, required: true },
    ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return { type: "object", additionalProperties: true }; }
}

export namespace PostSurveyWebhook
{
    export const URI : string = apiPath( "survey", 1, "/webhooks/:provider" );

    export interface Query { provider : string; }
    export interface Body extends RestfulEndpoint.NonAuthRequest { [ key : string ] : unknown; }
    export interface Response { ok : boolean; }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostSurveyWebhook;
// eof
