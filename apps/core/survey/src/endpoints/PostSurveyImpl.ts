//
import { randomUUID } from "node:crypto";

import { PostSurvey, Survey } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events } from "@repo/system";
import SurveyService from "../services/SurveyService";

//
// Create a survey definition in DRAFT state (survey-1.1). Server assigns id / accountId / status / version(0)
// / ownerId / timestamps; questions are sanitized on store (survey-7.2.1).
//
export class PostSurveyImpl extends PostSurvey
{
    private service : SurveyService;
    constructor( service : SurveyService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const name : string = this.body?.name ?? "";
        if( !name )          return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "name required" } };

        const now : Type.ISODateTime = new Date().toISOString();
        const id : Type.UUID = randomUUID();
        const entity : Survey.Entity =
        {
            id,
            accountId,
            name,
            status:    Survey.Status.DRAFT,
            version:   0,
            questions: this.service.sanitizeQuestions( this.body?.questions ?? [] ),
            scoring:   this.body?.scoring,
            ownerId:   auth.userId,
            createdAt: now,
            modifiedAt: now,
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "survey_surveys", { ...entity, surveyId: id } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "survey write failed" } };

        void this.service.emit( Events.Verb.CREATED, entity.id, accountId, entity, auth.userId );

        return { status: NetworkUtils.Status.OK, data: entity };
    }
}

export default PostSurveyImpl;
// eof
