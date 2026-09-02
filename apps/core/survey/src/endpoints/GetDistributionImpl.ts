//
import { GetDistribution, Distribution } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SurveyService from "../services/SurveyService";

//
// Read a distribution's status (survey-3.1).
//
export class GetDistributionImpl extends GetDistribution
{
    private service : SurveyService;
    constructor( service : SurveyService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const distributionId : string = this.query?.distributionId ?? "";
        if( !distributionId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "distributionId required" } };

        const got : Type.Result<Distribution.Entity | undefined> = await this.service.dynamo.get<Distribution.Entity>( "survey_distributions", { accountId, distributionId } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "distribution read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "distribution not found" } };

        return { status: NetworkUtils.Status.OK, data: ObjectUtils.withDefaults( got.data, Distribution.DEFAULT ) };
    }
}

export default GetDistributionImpl;
// eof
