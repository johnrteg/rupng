//
import type { Type } from "@repo/common";

import SurveyService from "./SurveyService";

import GetSurveyFormImpl from "../endpoints/GetSurveyFormImpl";
import PostSurveyFormImpl from "../endpoints/PostSurveyFormImpl";

//
// FORM role — the PUBLIC hosted-form capture ingress (survey-9.3): unauthenticated, abuse-hardened, meant
// to sit behind CloudFront + WAF and scale independently of the authed API. Only two routes: fetch the form
// by token, submit answers by token. Bot protection (CAPTCHA/Turnstile, survey-7.2) is verified here before
// any answer ever reaches `SurveyService.captureAnswers`.
//
export class SurveyFormService extends SurveyService
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( SurveyService.Role.FORM );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register the public form endpoint impls (after the inherited /health + /version). */
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version
        this.register( new GetSurveyFormImpl( this ) );
        this.register( new PostSurveyFormImpl( this ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Verify a CAPTCHA/Turnstile challenge response against the configured secret (survey-7.2). When no
     *  secret is configured (local dev — see `cloud/local/put-secrets.mjs`) this fails OPEN so the form
     *  works end-to-end without a real Cloudflare account; a deployed environment always has the secret
     *  seeded, so the fail-open path never applies there. */
    public async verifyCaptcha( token : string ) : Promise<boolean>
    {
        if( !token ) return false;

        const secret : Type.Result<string | undefined> = await this.secrets.get( "survey-captcha" );
        if( !secret.ok || !secret.data )
        {
            this.log.trace( "captcha verify skipped — no survey-captcha secret configured (dev)" );
            return true;
        }

        try
        {
            const response : globalThis.Response = await fetch( "https://challenges.cloudflare.com/turnstile/v0/siteverify", {
                method:  "POST",
                headers: { "content-type": "application/x-www-form-urlencoded" },
                body:    new URLSearchParams( { secret: secret.data, response: token } ),
            } );
            const result : { success? : boolean } = await response.json() as { success? : boolean };
            return result.success === true;
        }
        catch( error ) { this.log.warn( "captcha verify request failed", { error: String( error ) } ); return false; }
    }
}

export default SurveyFormService;
// eof
