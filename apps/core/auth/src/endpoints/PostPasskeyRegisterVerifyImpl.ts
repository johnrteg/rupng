//
import { PostPasskeyRegisterVerify } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
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
