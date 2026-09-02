//
import { PutSurveyConfig, SurveyConfig } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SurveyService from "../services/SurveyService";

//
// Update the account's survey config defaults (survey-4.4) — ACCOUNT-gated. Merges the patch over the live
// config, validates against SurveyConfig.SCHEMA, then persists a new AppConfig version + deploys it.
//
export class PutSurveyConfigImpl extends PutSurveyConfig
{
    private service : SurveyService;
    constructor( service : SurveyService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const current : SurveyConfig.Config = await this.service.surveyConfig();
        const merged : SurveyConfig.Config = ObjectUtils.withDefaults( { ...current, ...( this.body ?? {} ) }, SurveyConfig.DEFAULT );

        if( !SurveyConfig.validate( merged ) ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "invalid survey config" } };

        const saved : Type.Result<void> = await this.service.saveSurveyConfig( merged );
        if( !saved.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not save the config" } };

        return { status: NetworkUtils.Status.OK, data: merged };
    }
}

export default PutSurveyConfigImpl;
// eof
