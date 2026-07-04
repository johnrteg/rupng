//


import type { GetSession } from "@repo/api";
import { Access } from "@repo/system";

import PasswordPolicy from "../PasswordPolicy";
import AppModel from "../AppModel";


export default class AuthService
{
    private appdata : AppModel;

    public login                : AuthService.Session | null = null;   // the signed-in session (null = anonymous)
    public user                 : GetSession.Response | null = null;   // the signed-in user's profile (auth/GetSession)
    // the caller's effective account role — drives role-based UI (e.g. which nav items show). The account
    // ladder role is resolved server-side per request; until that's surfaced to the client, default to the
    // account owner (new sign-ups are provisioned as admins). TODO: set from the resolved membership role.
    private _role               : Access.Role = Access.AccountRole.ACCOUNT;
    public passwordPolicies     : PasswordPolicy;

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    constructor( app : AppModel )
    {
        this.appdata = app;
        this.passwordPolicies   = new PasswordPolicy();
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public makeEmpty() : void
    {
        this.login = null;
        this.user  = null;
        this.passwordPolicies = new PasswordPolicy();
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Establish (or restore) the signed-in session from an access token. The token's claims are DECODED
    * ONLY — the client never verifies the signature (prod verifies server-side via the Lambda
    * authorizer / JWKS); the client just needs the claims to know who's signed in and when it expires.
    * Pass null/empty to clear. After this, {@link validSession} reflects the session so authenticated
    * pages (e.g. the dashboard) render instead of bouncing to sign-in.
    */
    public setSession( token : string | null ) : void
    {
        this.login = token ? AuthService.decode( token ) : null;
        if( !this.login ) this.user = null;   // signed out → drop the cached profile too
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Cache the signed-in user's profile (from auth/GetSession). AppModel sets this after establishing a
     *  session; clearing the session clears it. */
    public setUser( user : GetSession.Response | null ) : void
    {
        this.user = user;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** The caller's effective account role — drives role-based UI (which nav items / actions are shown). */
    public role() : Access.Role { return this._role; }

    /** Set the caller's effective account role (from the resolved membership role, once surfaced). */
    public setRole( role : Access.Role ) : void { this._role = role; }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Returns if the current login session is valid.
    * @return true if the session if valid, false if it is not.
    */
    public validSession() : boolean
    {
        if( this.login === null ) return false;
        // expired token → treat as signed out (and drop it so we don't keep re-checking a dead session)
        if( this.login.expiresAt !== undefined && this.login.expiresAt <= Date.now() ) { this.login = null; return false; }
        return true;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** A human label for the signed-in user (for the account menu). Prefers the fetched profile (full name
     *  → display name → email), then the token's email, then a neutral "Account" (the Cognito username is a
     *  sub/UUID, not display-friendly). The profile is loaded via auth/GetSession after sign-in. */
    public displayName() : string
    {
        const u : GetSession.Response | null = this.user;
        if( u )
        {
            const full : string = `${ u.firstName ?? "" } ${ u.lastName ?? "" }`.trim();
            if( full )            return full;
            if( u.displayName )   return u.displayName;
            if( u.email )         return u.email;
        }
        return this.login?.email ?? "Account";
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Decode a JWT's payload into a Session (no signature verification — dev decode-only). */
    private static decode( token : string ) : AuthService.Session | null
    {
        try
        {
            const payload : string | undefined = token.split( "." )[ 1 ];
            if( !payload ) return null;
            const json : string = atob( payload.replace( /-/g, "+" ).replace( /_/g, "/" ) );
            const claims : Record<string, unknown> = JSON.parse( json ) as Record<string, unknown>;
            return {
                token,
                userId:    String( claims[ "sub" ] ?? claims[ "username" ] ?? "" ),
                username:  claims[ "username" ] !== undefined ? String( claims[ "username" ] ) : undefined,
                email:     claims[ "email" ] !== undefined ? String( claims[ "email" ] ) : undefined,
                // `exp` is in seconds → store an absolute ms deadline (undefined when the claim is absent)
                expiresAt: typeof claims[ "exp" ] === "number" ? ( claims[ "exp" ] as number ) * 1000 : undefined,
            };
        }
        catch { return null; }
    }
}

export namespace AuthService
{
    /** The signed-in session, decoded from the access token. */
    export interface Session
    {
        token      : string;
        userId     : string;
        username?  : string;
        email?     : string;
        expiresAt? : number;   // absolute expiry in epoch ms (from the token's `exp` claim)
    }
}
