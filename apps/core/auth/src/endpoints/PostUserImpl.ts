//
import { PostUser, User } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// Update the acting user's own profile. FIRST CUT applies the `augmented` route (icon / avatarAssetId → the
// DynamoDB users row); the `cognito` route is a follow-up. Returns the refreshed composed User.Entity.
//
export class PostUserImpl extends PostUser
{
    private service : AuthService;
    constructor( service : AuthService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const augmented : Partial<Pick<User.Augmented, "icon" | "avatarAssetId">> | undefined = this.body?.augmented;
        if( augmented === undefined ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "nothing to update" } };
        try
        {
            // merge the augmented fields into the user's DynamoDB row, then return the refreshed composed entity
            await this.service.users.updateAugmented( auth.userId, augmented );
            const user : User.Entity | undefined = await this.service.users.profile( auth.userId );
            if( user === undefined ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "profile read failed" } };
            const reply : PostUser.Response = { user };
            return { status: NetworkUtils.Status.OK, data: reply };
        }
        catch( err )
        {
            this.service.log.error( "PostUser", err );
            return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "server error" } };
        }
    }
}

export default PostUserImpl;
