//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Retire a registry domain (links-5.2) — platform staff (step-up: ROOT). Minting on a retired
// domain is blocked (links-5.4); existing codes keep resolving (out of scope to cascade-disable).
//
export class DeleteLinksDomain extends RestfulEndpoint< DeleteLinksDomain.Query, undefined, DeleteLinksDomain.Response >
{
    public readonly uri      : string = DeleteLinksDomain.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AppRole.ROOT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteLinksDomain
{
    export const URI : string = apiPath( "links", 1, "/domains/:id" );
    export interface Query { id : string; }
    export interface Response { retired : boolean; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default DeleteLinksDomain;
// eof
