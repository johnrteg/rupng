//
import { PostPasskeyRegisterVerify } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import { Events } from '@repo/services';
import AuthService from '../services/AuthService';

//
// Complete passkey enrolment — verify the attestation + store the credential.
//
export class PostPasskeyRegisterVerifyImpl extends PostPasskeyRegisterVerify
{
    private service : AuthService;
    constructor( service : AuthService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        try
        {
            const credentialId : string = await this.service.passkeys.registrationVerify( this.body!.ceremonyId, this.body!.response, auth.userId );
            void this.service.emit( Events.Object.AUTH_PASSKEY, Events.Verb.CREATED, "passkey", credentialId, auth.accountId ?? auth.userId, { credentialId, userId: auth.userId, createdAt: new Date().toISOString() }, auth.userId );
            const reply : PostPasskeyRegisterVerify.Response = { verified: true, credentialId };
            return { status: NetworkUtils.Status.OK, data: reply };
        }
        catch( err )
        {
            this.service.log.warn( "PostPasskeyRegisterVerify", err );
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "registration not verified" } };
        }
    }
}

export default PostPasskeyRegisterVerifyImpl;
