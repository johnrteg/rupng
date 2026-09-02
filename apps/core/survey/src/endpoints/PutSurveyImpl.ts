//
import { PutSurvey, Survey } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events } from "@repo/system";
import SurveyService from "../services/SurveyService";

//
// Update a survey definition — editable while DRAFT (a published survey is locked; publishing again to
// change it is a NEW version via PostSurveyPublish, not a PUT). Questions are sanitized on store (survey-7.2.1).
//
export class PutSurveyImpl extends PutSurvey
{
    private service : SurveyService;
    constructor( service : SurveyService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const surveyId : string = this.query?.surveyId ?? "";
        if( !surveyId )      return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "surveyId required" } };

        const got : Type.Result<Survey.Entity | undefined> = await this.service.dynamo.get<Survey.Entity>( "survey_surveys", { accountId, surveyId } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "survey read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "survey not found" } };

        const current : Survey.Entity = ObjectUtils.withDefaults( got.data, Survey.DEFAULT );
        if( current.status !== Survey.Status.DRAFT ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "only a draft survey can be edited" } };

        const merged : Survey.Entity =
        {
            ...current,
            name:      this.body?.name ?? current.name,
            questions: this.body?.questions ? this.service.sanitizeQuestions( this.body.questions ) : current.questions,
            scoring:   this.body?.scoring ?? current.scoring,
            modifiedAt: new Date().toISOString(),
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "survey_surveys", { ...merged, surveyId } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "survey write failed" } };

        void this.service.emit( Events.Verb.UPDATED, merged.id, accountId, merged, auth.userId );

        return { status: NetworkUtils.Status.OK, data: merged };
    }
}

export default PutSurveyImpl;
// eof
