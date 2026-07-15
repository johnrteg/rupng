//
import { createHmac } from "crypto";

//
// Session — mints an auth-issued session token (a compact HS256 JWT). This is the seam for the real
// session model (the spec's auth-owned sessions backed by the `sessions` table with rotation +
// revocation); for now it's a self-contained signed token so flows WITHOUT a Cognito password
// (notably passkey sign-in) can still establish a session that the request auth-context understands.
//
// DEV: signed with a dev secret; the base service currently DECODES tokens (Cognito or this) without
// verifying the signature — in production the API Gateway Lambda authorizer verifies. `verify()` is
// provided for when enforcement moves server-side.
//
export class Session
{
    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /** HS256 signing secret — override via env in any real environment. */
    private static secret() : string
    { return process.env.AUTH_SESSION_SECRET ?? "dev-insecure-session-secret"; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Issue a signed session token for a user. */
    public static issue( claims : Session.Claims, ttlSeconds : number = 3600 ) : string
    {
        const now : number = Math.floor( Date.now() / 1000 );
        const header  : object = { alg: "HS256", typ: "JWT" };
        const payload : object = { sub: claims.userId, username: claims.username, role: claims.role, iat: now, exp: now + ttlSeconds };

        const head : string = Session.b64url( JSON.stringify( header ) );
        const body : string = Session.b64url( JSON.stringify( payload ) );
        const signature : string = Session.sign( `${head}.${body}` );
        return `${head}.${body}.${signature}`;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Verify a token's signature + expiry; returns the claims or `undefined`. */
    public static verify( token : string ) : Session.Claims | undefined
    {
        const parts : Array<string> = token.split( "." );
        if( parts.length !== 3 ) return undefined;
        if( Session.sign( `${parts[ 0 ]}.${parts[ 1 ]}` ) !== parts[ 2 ] ) return undefined;

        try
        {
            const payload : Record<string, unknown> = JSON.parse( Buffer.from( parts[ 1 ], "base64url" ).toString( "utf-8" ) );
            if( typeof payload.exp === "number" && payload.exp < Math.floor( Date.now() / 1000 ) ) return undefined;
            return { userId: String( payload.sub ?? "" ), username: String( payload.username ?? "" ), role: payload.role as string | undefined };
        }
        catch { return undefined; }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private static sign( data : string ) : string
    {
        return createHmac( "sha256", Session.secret() ).update( data ).digest( "base64url" );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    private static b64url( value : string ) : string
    {
        return Buffer.from( value, "utf-8" ).toString( "base64url" );
    }
}

export namespace Session
{
    export interface Claims { userId : string; username : string; role? : string; }
}

export default Session;
