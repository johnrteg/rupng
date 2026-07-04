//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Browse } from "./model/Browse";

// List the Browse providers enabled for the acting account + their capabilities (media-13) — drives the UI's
// provider multi-select and kind/cost filters.
export class GetBrowseProviders extends RestfulEndpoint<{}, undefined, GetBrowseProviders.Response>
{
    public readonly uri      : string = GetBrowseProviders.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetBrowseProviders
{
    export const URI : string = apiPath( "media", 1, "/browse/providers" );
    export interface Response { providers : Array<Browse.ProviderInfo>; }
}

export default GetBrowseProviders;
