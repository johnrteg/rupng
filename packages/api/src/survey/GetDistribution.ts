//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Distribution } from "./model/Distribution";

//
// Read a distribution's status (survey-3.1). SENDER-gated.
//
export class GetDistribution extends RestfulEndpoint< GetDistribution.Query, undefined, GetDistribution.Response >
{
    public readonly uri      : string = GetDistribution.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.SENDER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getDistribution",
        summary:     "Read a distribution",
        description: "Reads one distribution's status by id.",
        tags:        [ "Survey" ],
    };

    constructor( distributionId? : string ) { super( { distributionId: distributionId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "distributionId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetDistribution
{
    export const URI : string = apiPath( "survey", 1, "/distributions/:distributionId" );

    export interface Query { distributionId : string; }
    export interface Response extends Distribution.Entity {}

    export enum Error
    {
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetDistribution;
// eof
