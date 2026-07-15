//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { StudioProject } from "./model/StudioProject";

// List the account's Studio projects (the project tree). Metadata only — the tldraw canvas snapshot for a
// project is fetched separately (GetStudioCanvas) so listing stays light.
export class GetStudioProjects extends RestfulEndpoint<{}, undefined, GetStudioProjects.Response>
{
    public readonly uri      : string = GetStudioProjects.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetStudioProjects
{
    export const URI : string = apiPath( "media", 1, "/projects" );
    export interface Response { records : Array<StudioProject.Entity>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetStudioProjects;
