//
import { PostSurveyForm, SurveyResponse, Distribution } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SurveyFormService from "../services/SurveyFormService";
import SurveyTokenStore from "../services/SurveyTokenStore";

//
// PUBLIC — submit answers against a signed PURL/submission token (survey-2.2 / 7.2 / 7.3). Bot-protected
// (CAPTCHA, survey-7.2) + delegates the actual capture/scoring/contact-landing to
// `SurveyService.captureAnswers` — the SAME core the S2S internal-ingest path uses (survey-2.5's "all
// runners normalize to the same Survey/Question ids").
//
export class PostSurveyFormImpl extends PostSurveyForm
{
    private service : SurveyFormService;
    constructor( service : SurveyFormService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const token : string = this.query?.token ?? "";
        if( !token ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "token required" } };
        const body : PostSurveyForm.Body | null = this.body;
        if( !body?.answers?.length ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "at least one answer is required" } };

        const verified : boolean = await this.service.verifyCaptcha( body.captchaToken );
        if( !verified ) return { status: NetworkUtils.Status.FORBIDDEN, data: { message: "bot-protection challenge failed" } };

        const found : Type.Result<SurveyTokenStore.Entity | undefined> = await this.service.tokens.get( token );
        if( !found.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "token read failed" } };
        if( !found.data ) return { status: NetworkUtils.Status.GONE, data: { message: "this survey link has expired" } };

        const captured : Type.Result<SurveyResponse.Entity> = await this.service.captureAnswers( {
            accountId:      found.data.accountId,
            surveyId:       found.data.surveyId,
            distributionId: found.data.distributionId,
            contactId:      found.data.contactId,
            channel:        Distribution.Channel.EMAIL,   // the hosted form is the email/web runner (survey-2.2)
            responseId:     found.data.responseId,
            answers:        body.answers,
            complete:       body.complete,
        } );
        if( !captured.ok ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: String( captured.error ) } };

        const remaining : Array<string> = captured.data.status === SurveyResponse.Status.COMPLETED ? [] : [ captured.data.lastQuestionId ?? "" ];
        return { status: NetworkUtils.Status.OK, data: { status: captured.data.status, nextQuestionId: remaining[ 0 ] || undefined } };
    }
}

export default PostSurveyFormImpl;
// eof
