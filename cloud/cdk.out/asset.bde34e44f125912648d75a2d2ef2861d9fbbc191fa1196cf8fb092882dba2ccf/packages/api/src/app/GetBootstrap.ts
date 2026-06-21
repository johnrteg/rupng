//
import { RestfulEndpoint, Access } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

/*
    client:
    const endpt : GetBootstrap = new GetBootstrap( { } );
    const response : Restful.Response = await appdata.server.fetch( endpt );
*/
export class GetBootstrap extends RestfulEndpoint< {}, undefined >
{
    public readonly uri      : string = GetBootstrap.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;   // edge-reachable, not a published dev API

    constructor()
    {
        super( {} );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [];
    }

    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }   // method stays, returns null
}


export namespace GetBootstrap
{
    export const URI : string = "/app/bootstrap";

    export interface Response
    {
        maxUploadSize : { texting : number };
    }

    // possible error type
    export enum Error
    {
        BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }

}

export default GetBootstrap;