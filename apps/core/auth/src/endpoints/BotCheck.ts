//
// Anti-bot gate for the enumeration-revealing branch of registration.
//
// The open sign-up surface is enumeration-neutral: an already-registered identifier returns the SAME
// acknowledgement as a new one, so it can't be probed. We only relax that to a truthful "already
// registered — sign in" AFTER proving the caller is human (CAPTCHA / Turnstile / hCaptcha), which makes
// mass enumeration uneconomical. This verifies that proof server-side.
//
// STATUS: the real provider isn't wired yet, so in every REAL environment no token can pass → the
// reveal stays off and registration remains fully neutral (fail-closed). In the LOCAL dev environment a
// non-empty token is accepted so the reveal path is testable end-to-end without a provider.
// TODO: call the provider's siteverify endpoint with the secret from Secrets Manager (never AppConfig).
//
export async function verifyBotToken( token? : string ) : Promise<boolean>
{
    if( !token ) return false;                                                  // no proof → never reveal
    if( ( process.env.ENVIRONMENT ?? "" ).toLowerCase() === "local" ) return true;   // dev-only bypass (local)
    return false;                                                               // TODO: real provider verification
}

export default verifyBotToken;
