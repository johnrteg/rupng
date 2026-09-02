//
import { PostSurveyWebhook } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SurveyService from "../services/SurveyService";

//
// Inbound external-provider completion webhook (SurveyMonkey/Typeform/... via marketplace, survey-2.3/6.0).
// ACK-fast: enqueues the raw payload to `survey-ingest` for `processIngest` to verify/normalize off the
// request path (same pattern as PostSocialWebhookImpl) — never processed inline, so a slow/misbehaving
// provider can't hold the request open.
//
export class PostSurveyWebhookImpl extends PostSurveyWebhook
{
    private service : SurveyService;
    constructor( service : SurveyService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const provider : string = this.query?.provider ?? "";
        if( !provider ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "provider required" } };

        const sent : Type.Result<void> = await this.service.sqs.send( "survey-ingest", { provider, payload: this.body ?? {} } );
        if( !sent.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not queue webhook for processing" } };

        return { status: NetworkUtils.Status.OK, data: { ok: true } };
    }
}

export default PostSurveyWebhookImpl;
// eof
