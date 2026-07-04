//
// LocalStorage — a thin, typed wrapper over `window.localStorage` and the single place the app persists
// browser-local state. Unlike the cookies in StorageService, localStorage values are same-origin only and
// are NEVER sent to the server automatically — the app reads them and attaches what it needs (e.g. the
// access token as an `Authorization: Bearer` header). It owns the session-key constants + session-token
// helpers so persistence lives in one place; AppModel just orchestrates (bearer header + claim decode).
//
export class LocalStorage
{
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public makeEmpty() : void
    {
    }

    // ── generic access ───────────────────────────────────────────────────────────────────────────────────────
    /** Read a raw value, or null when absent. */
    public get( key : string ) : string | null { return window.localStorage.getItem( key ); }
    /** Write a raw value. */
    public set( key : string, value : string ) : void { window.localStorage.setItem( key, value ); }
    /** Remove a value (no-op if absent). */
    public remove( key : string ) : void { window.localStorage.removeItem( key ); }

    // ── session tokens ───────────────────────────────────────────────────────────────────────────────────────
    /** The persisted access (session) token, or null. */
    public sessionToken() : string | null { return this.get( LocalStorage.SESSION_KEY ); }

    /** The persisted Cognito refresh token, or null. */
    public refreshToken() : string | null { return this.get( LocalStorage.REFRESH_KEY ); }

    /** Persist the session: always the access token; the refresh token ONLY when provided (a refresh
     *  returns just a new access token, so the cached refresh token must be preserved across refreshes). */
    public storeSession( accessToken : string, refreshToken? : string ) : void
    {
        this.set( LocalStorage.SESSION_KEY, accessToken );
        if( refreshToken ) this.set( LocalStorage.REFRESH_KEY, refreshToken );
    }

    /** Clear both session tokens (sign-out). The current-account preference is kept so a returning user
     *  resumes their last account (it's cleared/reset only when they're no longer a member). */
    public clearSession() : void
    {
        this.remove( LocalStorage.SESSION_KEY );
        this.remove( LocalStorage.REFRESH_KEY );
    }

    // ── current/last account ─────────────────────────────────────────────────────────────────────────
    /** The id of the account the user was last acting in (resume target on next sign-in), or null. */
    public currentAccount() : string | null { return this.get( LocalStorage.ACCOUNT_KEY ); }
    /** Remember the account the user is acting in. */
    public setCurrentAccount( accountId : string ) : void { this.set( LocalStorage.ACCOUNT_KEY, accountId ); }
}

export namespace LocalStorage
{
    /** localStorage key for the persisted access (session) token. */
    export const SESSION_KEY : string = "auth.session";
    /** localStorage key for the persisted Cognito refresh token (exchanged for fresh access tokens). */
    export const REFRESH_KEY : string = "auth.refresh";
    /** localStorage key for the user's last/current account id (resume there on next sign-in). */
    export const ACCOUNT_KEY : string = "auth.account";
}

export default LocalStorage;
