//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { AuthAction } from "./model/AuthAction";

//
// List pending actions app-wide (INTERNAL) — the Console's "Actions" tab reads this to show the queue (request +
// whether/when acted upon) and to cancel. Optionally filtered by status / type. Rows auto-expire via DDB TTL.
//
export class GetAuthActions extends RestfulEndpoint< GetAuthActions.Query, undefined, GetAuthActions.Response >
{
    public readonly uri      : string = GetAuthActions.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role | undefined = Access.AppRole.APPLICATION;   // app/root staff
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( query? : GetAuthActions.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "status", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "type",   location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetAuthActions
{
    export const URI : string = apiPath( "auth", 1, "/actions" );
    export interface Query { status? : AuthAction.Status; type? : AuthAction.Type; }
    export interface Response { records : Array<AuthAction.Entity>; }
}

export default GetAuthActions;
// eof
