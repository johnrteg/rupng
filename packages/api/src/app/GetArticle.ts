//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";

//
// Fetch a single help/knowledge-base article by id (help-center content, Zendesk-shaped). Edge-reachable
// (APP audience), non-authenticated — help content is public. Impl is a STUB for now ("coming soon…").
//
export class GetArticle extends RestfulEndpoint< GetArticle.Query, undefined, GetArticle.Response >
{
    public readonly uri      : string = GetArticle.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated (public help content)
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getArticle",
        summary:     "Get a help article",
        description: "Fetches a single help-center article by id.",
        tags:        [ "App" ],
        errors:      { 404: "No such article" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetArticle
{
    export const URI : string = apiPath( "app", 1, "/articles/:id" );   // /api/app/v1/articles/:id

    export interface Query
    {
        id : Type.UUID;
    }

    /** A help-center article (Zendesk-shaped source fields). */
    export interface Article
    {
        id                  : string;
        author_id           : string;
        body                : string;
        comments_disabled   : boolean;
        content_tag_ids     : Array<string>;
        created_at          : Type.ISODateTime;
        draft               : boolean;
        edited_at           : Type.ISODateTime;
        html_url            : string;
        label_names         : Array<string>;
        locale              : string;
        name                : string;
        outdated            : boolean;
        outdated_locales    : Array<string>;
        permission_group_id : string;
        position            : number;
        promoted            : boolean;
        section_id          : string;
        source_locale       : string;
        title               : string;
        updated_at          : Type.ISODateTime;
        url                 : string;
        user_segment_id     : number;
        vote_count          : number;
        vote_sum            : number;
    }

    export interface Response
    {
        article? : Article;
        message? : string;   // stub placeholder ("coming soon…") until the help-center integration lands
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetArticle;
