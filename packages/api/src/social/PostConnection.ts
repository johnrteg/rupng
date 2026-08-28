//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { SocialAccount } from "./model/SocialAccount";

//
// Connect a destination — initiates a marketplace OAuth connect flow for the platform. 409 if the
// account is already at its plan's connected-profile quota for that network. ACCOUNT-gated (highest
// tier of the account access ladder — connection management, per CLAUDE.md).
//
export class PostConnection extends RestfulEndpoint< {}, PostConnection.Body, PostConnection.Response >
{
    public readonly uri      : string = PostConnection.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createSocialConnection",
        summary:     "Connect a destination",
        description: "Starts a marketplace OAuth connect flow for the requested platform/destination.",
        tags:        [ "Social" ],
        errors:      { 409: "Over the plan's connected-profile quota for this network" },
    };

    constructor( body? : PostConnection.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true, required: [ "platform" ],
            properties: {
                platform: { type: "string", enum: Object.values( SocialAccount.Platform ) },
                handle:   { type: "string" },
                scopes:   { type: "array" },
            },
        };
    }
}

export namespace PostConnection
{
    export const URI : string = apiPath( "social", 1, "/connections" );

    export interface Body extends RestfulEndpoint.AuthRequest, SocialAccount.CreateConnection {}

    export interface Response
    {
        id:            string;   // connectionId
        platform:      SocialAccount.Platform;
        status:        SocialAccount.ConnectionStatus;
        authorizeUrl?: string;   // hand to the frontend OAuth UI to complete the connect
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        CONFLICT              = NetworkUtils.Status.CONFLICT,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostConnection;
