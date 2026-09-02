//
import { GetSurveys, Survey, Paging } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SurveyService from "../services/SurveyService";

//
// List the acting account's survey definitions. Query the accountId partition, hydrate from DEFAULT, hide
// ARCHIVED unless a status filter asks otherwise (same shape as GetCampaignsImpl).
//
export class GetSurveysImpl extends GetSurveys
{
    private service : SurveyService;
    constructor( service : SurveyService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const found : Type.Result<Array<Survey.Entity>> = await this.service.dynamo.query<Survey.Entity>( "survey_surveys", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "surveys read failed" } };

        const query : GetSurveys.Query = this.query ?? {};
        const surveys : Array<Survey.Entity> = found.data
            .map( ( row : Survey.Entity ) : Survey.Entity => ObjectUtils.withDefaults( row, Survey.DEFAULT ) )
            .filter( ( row : Survey.Entity ) : boolean => query.status ? row.status === query.status : row.status !== Survey.Status.ARCHIVED )
            .sort( ( first : Survey.Entity, second : Survey.Entity ) : number => String( second.createdAt ?? "" ).localeCompare( String( first.createdAt ?? "" ) ) );

        const paged : Paging.Result<Survey.Entity> = Paging.paginate( surveys, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetSurveysImpl;
// eof
