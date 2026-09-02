//
import { PostSurveyPublish, Survey } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events } from "@repo/system";
import SurveyService from "../services/SurveyService";

//
// Publish a survey (draft -> published), bumping `version` (survey-1.4). Every Response captured against
// this survey from now on pins the NEW version; historical responses keep pointing at the version they
// actually answered, so editing after publish never retroactively changes past results.
//
export class PostSurveyPublishImpl extends PostSurveyPublish
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
        if( !current.questions.length ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "a survey needs at least one question to publish" } };

        const now : Type.ISODateTime = new Date().toISOString();
        const published : Survey.Entity =
        {
            ...current,
            status:      Survey.Status.PUBLISHED,
            version:     current.version + 1,
            modifiedAt:  now,
            publishedAt: now,
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "survey_surveys", { ...published, surveyId } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "survey write failed" } };

        void this.service.emit( Events.Verb.UPDATED, published.id, accountId, published, auth.userId );

        return { status: NetworkUtils.Status.OK, data: published };
    }
}

export default PostSurveyPublishImpl;
// eof
