//
import { PostVerifyPhone } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// Phone verification during registration. The user-attribute verify flow (GetUserAttributeVerificationCode
// / VerifyUserAttribute) requires the user's own access token, which the registration flow doesn't hold
// yet — so this remains a best-effort placeholder: reports sent (no code) / verified (code supplied).
// TODO: wire the access-token-based attribute verification once registration carries a session.
//
export class PostVerifyPhoneImpl extends PostVerifyPhone
{
    private service : AuthService;

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    constructor( service : AuthService )
    {
        super();
        this.service = service;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const confirming : boolean = ( this.body?.code ?? "" ) !== "";
        this.service.log.info( "PostVerifyPhone (placeholder)", { phone: this.body?.phone, confirming } );
        const reply : PostVerifyPhone.Response = confirming ? { verified: true } : { sent: true };
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default PostVerifyPhoneImpl;
