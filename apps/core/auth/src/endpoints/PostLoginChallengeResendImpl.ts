//
import { PostLoginChallengeResend } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// Resend a code-based login challenge. Best-effort (enumeration-neutral: always reports sent).
//
export class PostLoginChallengeResendImpl extends PostLoginChallengeResend
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
        try { await this.service.users.resendCode( this.body?.challengeToken ?? "" ); } catch { /* neutral */ }
        const reply : PostLoginChallengeResend.Response = { sent: true };
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default PostLoginChallengeResendImpl;
