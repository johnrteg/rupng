//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { User } from "./model/User";

//
// Update the acting user's own profile (the documented write path for `User.Update`). Routes each part to its
// store: `augmented` → the DynamoDB users row (icon, avatarAssetId); `cognito` → Cognito AdminUpdateUserAttributes.
// FIRST CUT ships the `augmented` route (media-23 avatars set `avatarAssetId` here); the `cognito` route (name /
// picture / locale / timezone) is a follow-up that needs an attribute-update method on the Cognito facade.
// Returns the refreshed composed `User.Entity`.
//
export class PostUser extends RestfulEndpoint<{}, PostUser.Body, PostUser.Response>
{
    public readonly uri      : string = PostUser.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;   // the caller edits their OWN profile
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostUser.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, properties: {
            augmented: { type: "object", additionalProperties: false, properties: {
                icon:          { type: "string" },
                avatarAssetId: { type: "string" },
            } },
        } };
    }
}

export namespace PostUser
{
    export const URI : string = apiPath( "auth", 1, "/user" );
    export interface Body extends RestfulEndpoint.AuthRequest { augmented? : Partial<Pick<User.Augmented, "icon" | "avatarAssetId">>; }
    export interface Response { user : User.Entity; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostUser;
