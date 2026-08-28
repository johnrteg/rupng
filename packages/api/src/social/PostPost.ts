//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { SocialPost } from "./model/SocialPost";

//
// Create a post in DRAFT state (or scheduled, when `scheduleAt` is supplied). Server assigns id /
// accountId / status / approvalsRequired / timestamps. SENDER-gated.
//
export class PostPost extends RestfulEndpoint< {}, PostPost.Body, PostPost.Response >
{
    public readonly uri      : string = PostPost.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.SENDER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createSocialPost",
        summary:     "Create a post",
        description: "Creates a post in draft state (or scheduled, when scheduleAt is supplied).",
        tags:        [ "Social" ],
    };

    constructor( body? : PostPost.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true, required: [ "body", "targets" ],
            properties: {
                body:       { type: "string", minLength: 1 },
                mediaKeys:  { type: "array" },
                targets:    { type: "array", minItems: 1 },
                scheduleAt: { type: "string" },
            },
        };
    }
}

export namespace PostPost
{
    export const URI : string = apiPath( "social", 1, "/posts" );

    export interface Body extends RestfulEndpoint.AuthRequest, SocialPost.CreatePost {}
    export interface Response extends SocialPost.Entity {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostPost;
