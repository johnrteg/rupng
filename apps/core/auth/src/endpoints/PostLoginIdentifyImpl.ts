//
import { PostLoginIdentify, Login } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';

//
// Stepped sign-in, step 1 (identify). Identifier-first stays enumeration-neutral: ALWAYS advance to a
// password challenge for any well-formed identifier (SSO routing is by email domain, not user existence).
// The challengeToken threads the identifier to /login/challenge.
//
export class PostLoginIdentifyImpl extends PostLoginIdentify
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
        const account : string = this.body?.account ?? "";
        const reply : PostLoginIdentify.Response = { challengeToken: account, challenges: [ Login.ChallengeType.PASSWORD ] };
        return { status: NetworkUtils.Status.OK, data: reply };
    }
}

export default PostLoginIdentifyImpl;
