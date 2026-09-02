//
import { GetSurveyForm, Survey, Question, SurveyResponse } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SurveyService from "../services/SurveyService";
import SurveyTokenStore from "../services/SurveyTokenStore";

//
// PUBLIC — fetch the hosted-form render for a signed PURL/submission token (survey-2.2 / 7.3). Anonymous
// (the token IS the credential); never leaks the underlying survey/contact id beyond what's needed to render.
// Returns only unanswered questions (in order) + overall progress; a fully-completed response returns
// `completed: true` with an empty question list (thank-you state).
//
export class GetSurveyFormImpl extends GetSurveyForm
{
    private service : SurveyService;
    constructor( service : SurveyService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const token : string = this.query?.token ?? "";
        if( !token ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "token required" } };

        const found : Type.Result<SurveyTokenStore.Entity | undefined> = await this.service.tokens.get( token );
        if( !found.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "token read failed" } };
        if( !found.data ) return { status: NetworkUtils.Status.GONE, data: { message: "this survey link has expired" } };

        const surveyGot : Type.Result<Survey.Entity | undefined> = await this.service.dynamo.get<Survey.Entity>( "survey_surveys", { accountId: found.data.accountId, surveyId: found.data.surveyId } );
        if( !surveyGot.ok || !surveyGot.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "survey not found" } };
        const survey : Survey.Entity = ObjectUtils.withDefaults( surveyGot.data, Survey.DEFAULT );

        const responseGot : Type.Result<SurveyResponse.Entity | undefined> = await this.service.dynamo.get<SurveyResponse.Entity>( "survey_responses", { accountId: found.data.accountId, responseId: found.data.responseId } );
        const answeredIds : Array<string> = responseGot.ok && responseGot.data ? responseGot.data.answers.map( ( entry : SurveyResponse.Answer ) : string => entry.questionId ) : [];
        const completed : boolean = responseGot.ok && responseGot.data?.status === SurveyResponse.Status.COMPLETED;

        const remaining : Array<Question.Entity> = completed ? [] : survey.questions
            .filter( ( question : Question.Entity ) : boolean => !answeredIds.includes( question.id ) )
            .sort( ( first : Question.Entity, second : Question.Entity ) : number => first.order - second.order );

        return { status: NetworkUtils.Status.OK, data: {
            surveyName:    survey.name,
            questions:     this.service.sanitizeQuestions( remaining ),
            answeredCount: answeredIds.length,
            totalCount:    survey.questions.length,
            completed,
        } };
    }
}

export default GetSurveyFormImpl;
// eof
