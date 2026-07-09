//
import { PostAuthActionConsume, AuthAction } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import AuthService from "../services/AuthService";
import UserStore from "../services/UserStore";

//
// Consume a pending action (anonymous, token-gated) — the landing page calls this once the user acts. Rejects a
// missing (404) or expired/already-used (410) action; otherwise marks it CONSUMED and returns the public view.
// NOTE: type-specific side effects (e.g. flip the user's email to verified, accept the invite) are wired per
// type in a follow-up — this foundation records the consume so the flow + Console are correct.
//
export class PostAuthActionConsumeImpl extends PostAuthActionConsume
{
    private service : AuthService;
    constructor( service : AuthService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const token : string = this.query?.token ?? "";
        const got : Type.Result<AuthAction.Entity | undefined> = await this.service.actions.get( token );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not read the action" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "action not found" } };

        const entity : AuthAction.Entity = got.data;
        const nowSec : number = Math.floor( Date.now() / 1000 );
        if( entity.status !== AuthAction.Status.PENDING || entity.expiresAt < nowSec )
            return { status: NetworkUtils.Status.GONE, data: { message: "this link has expired or was already used" } };

        // perform the type-specific EFFECT before marking consumed — a failed effect leaves the action PENDING so
        // the link can be retried (never mark it used without the effect actually taking hold)
        const effect : RestfulEndpoint.Response | undefined = await this.applyEffect( entity );
        if( effect !== undefined ) return effect;   // an error response short-circuits

        const consumed : Type.Result<AuthAction.Entity> = await this.service.actions.consume( entity );
        if( !consumed.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not consume the action" } };

        const view : AuthAction.PublicView = { type: consumed.data.type, status: consumed.data.status, target: consumed.data.target, expiresAt: consumed.data.expiresAt };
        return { status: NetworkUtils.Status.OK, data: { action: view } };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    // apply the action's REAL effect (verify the email / set the new password) via Cognito admin. Returns an
    // error Response to short-circuit, or undefined on success (incl. types with no server-side effect yet).
    private async applyEffect( entity : AuthAction.Entity ) : Promise<RestfulEndpoint.Response | undefined>
    {
        if( !entity.userId ) return undefined;   // no subject to act on (a targetless action) — just record consume

        if( entity.type === AuthAction.Type.EMAIL_VERIFICATION )
        {
            // mark the Cognito attribute verified (source of truth) …
            const verified : Type.Result<void> = await this.service.cognito.verifyEmail( UserStore.POOL, entity.userId );
            if( !verified.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not verify the email" } };
            // … then flip the app's user row to verified + ACTIVE (best-effort; the Cognito attr already stuck)
            await this.service.users.markVerified( entity.userId );
        }
        else if( entity.type === AuthAction.Type.PASSWORD_RESET )
        {
            const password : string = this.body?.params?.password ?? "";
            if( password.length < 8 ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "a valid new password is required" } };
            const set : Type.Result<void> = await this.service.cognito.setPassword( UserStore.POOL, entity.userId, password );
            if( !set.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not set the new password" } };
        }
        // ACCOUNT_INVITE / MFA_CODE / UNSUBSCRIBE — no Cognito effect in this pass (invite membership + suppression
        // list are follow-ups); the consume is still recorded.
        return undefined;
    }
}

export default PostAuthActionConsumeImpl;
