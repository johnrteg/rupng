//
import { PostInternalResponse, Distribution, SurveyResponse } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SurveyService from "../services/SurveyService";

//
// S2S: ingest one captured answer/response from a channel runner — workflow's `collect-input` completion
// (SMS, survey-2.1) or other channel inbound — into `SurveyService.captureAnswers` (survey-4.1). INTERNAL
// audience; no user session, caller passes accountId/contactId explicitly.
//
export class PostInternalResponseImpl extends PostInternalResponse
{
    private service : SurveyService;
    constructor( service : SurveyService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostInternalResponse.Body | null = this.body;
        if( !body?.accountId || !body.surveyId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId and surveyId are required" } };

        const captured : Type.Result<SurveyResponse.Entity> = await this.service.captureAnswers( {
            accountId:      body.accountId,
            surveyId:       body.surveyId,
            distributionId: body.distributionId,
            contactId:      body.contactId,
            channel:        ( body.channel as Distribution.Channel ) ?? Distribution.Channel.SMS,
            answers:        body.answers,
            complete:       body.complete,
        } );
        if( !captured.ok ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: String( captured.error ) } };

        return { status: NetworkUtils.Status.OK, data: { responseId: captured.data.id } };
    }
}

export default PostInternalResponseImpl;
// eof
