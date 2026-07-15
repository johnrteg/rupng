//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Account } from "./model/Account";


export class GetAccount extends RestfulEndpoint< {}, undefined, GetAccount.Response >
{
    public readonly uri      : string = GetAccount.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.MINIMUM;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;   // edge-reachable, not a published dev API

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


export namespace GetAccount
{
    export const URI : string = apiPath( "acct", 1, "/account" );

    export interface Request
    {
        id : Type.UUID;
    }

    // the fetched account — the shared contract record (see ./Account)
    export interface Response extends Account.Entity
    {
    }

    // possible error type
    export enum Error
    {
        BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetAccount;
