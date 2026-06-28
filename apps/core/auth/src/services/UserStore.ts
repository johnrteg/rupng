//
import { randomUUID } from "crypto";

import {
    ListUserPoolClientsCommand,
    AdminInitiateAuthCommand,
    SignUpCommand, ConfirmSignUpCommand, ResendConfirmationCodeCommand,
    AdminGetUserCommand, ListUsersCommand,
    AdminUserGlobalSignOutCommand,
    ForgotPasswordCommand, ConfirmForgotPasswordCommand,
    type AttributeType, type UserType,
    type AdminInitiateAuthCommandOutput, type AuthenticationResultType
} from "@aws-sdk/client-cognito-identity-provider";

import type { Cognito, Dynamo } from "@repo/services";
import { User } from "@repo/api";
import type { UserMeta } from "@repo/api";

//
// UserStore — the auth data layer. Cognito is the credential authority (passwords, MFA, the tokens);
// DynamoDB holds the platform metadata (`users` row, `user_meta`). Endpoint impls call these methods
// and stay thin. Cognito ops go through the facade's raw client + resolved pool id; the user-pool
// CLIENT id (needed for SignUp / InitiateAuth) is resolved at runtime via ListUserPoolClients (cached),
// since the manifest resolver exposes only the pool id.
//
export class UserStore
{
    public static readonly POOL : string = "users";          // cognito user-pool logical key
    public static readonly USERS : string = "users";         // dynamo users table key
    public static readonly USER_META : string = "user_meta"; // dynamo user_meta table key

    private _clientId? : string;

    constructor( private readonly cognito : Cognito, private readonly dynamo : Dynamo ) {}

    ////////////////////////////////////////////////////////////////////////////////////////////
    private get poolId() : string { return this.cognito.poolId( UserStore.POOL ); }

    /** Resolve (and cache) the user pool's app client id — needed by SignUp / InitiateAuth. */
    private async clientId() : Promise<string>
    {
        if( this._clientId ) return this._clientId;
        const out = await this.cognito.client.send( new ListUserPoolClientsCommand( { UserPoolId: this.poolId, MaxResults: 10 } ) );
        const id : string | undefined = out.UserPoolClients?.[ 0 ]?.ClientId;
        if( !id ) throw new Error( "no user-pool app client found" );
        return this._clientId = id;
    }

    // ── credentials / sessions ──────────────────────────────────────────────────────────────────

    /**
     * Sign in with username (email/phone) + password via Cognito. Returns the issued tokens, or a
     * `challenge` name when Cognito requires another step (e.g. NEW_PASSWORD_REQUIRED / SMS_MFA).
     */
    public async login( account : string, password : string ) : Promise<UserStore.LoginResult>
    {
        const response : AdminInitiateAuthCommandOutput = await this.cognito.client.send( new AdminInitiateAuthCommand( {
            UserPoolId:     this.poolId,
            ClientId:       await this.clientId(),
            AuthFlow:       "ADMIN_USER_PASSWORD_AUTH",
            AuthParameters: { USERNAME: account, PASSWORD: password },
        } ) );

        const authentication : AuthenticationResultType | undefined = response.AuthenticationResult;
        if( authentication )
            return { complete: true, tokens: { accessToken: authentication.AccessToken ?? "", idToken: authentication.IdToken, refreshToken: authentication.RefreshToken, expiresIn: authentication.ExpiresIn } };

        return { complete: false, challenge: response.ChallengeName };
    }

    /** Rotate a refresh token → a fresh access token (Cognito REFRESH_TOKEN_AUTH). */
    public async refresh( refreshToken : string ) : Promise<UserStore.Tokens>
    {
        const response : AdminInitiateAuthCommandOutput = await this.cognito.client.send( new AdminInitiateAuthCommand( {
            UserPoolId:     this.poolId,
            ClientId:       await this.clientId(),
            AuthFlow:       "REFRESH_TOKEN_AUTH",
            AuthParameters: { REFRESH_TOKEN: refreshToken },
        } ) );

        const authentication : AuthenticationResultType | undefined = response.AuthenticationResult;
        if( !authentication?.AccessToken ) throw new Error( "refresh failed" );
        return { accessToken: authentication.AccessToken, idToken: authentication.IdToken, refreshToken: authentication.RefreshToken, expiresIn: authentication.ExpiresIn };
    }

    /** Revoke all of a user's sessions (logout-everywhere). */
    public async signOut( username : string ) : Promise<void>
    {
        await this.cognito.client.send( new AdminUserGlobalSignOutCommand( { UserPoolId: this.poolId, Username: username } ) );
    }

    // ── registration ────────────────────────────────────────────────────────────────────────────

    /**
     * Self-service sign-up: create the Cognito user (sends the verification code) + write the pending
     * `users` row. Returns the new user's sub + which channel to verify.
     */
    public async register( input : UserStore.RegisterInput ) : Promise<UserStore.Registered>
    {
        const emailMethod : boolean = input.method !== "phone";
        const attributes : AttributeType[] = [
            { Name: "given_name",  Value: input.firstName },
            { Name: "family_name", Value: input.lastName },
        ];
        if( emailMethod ) attributes.push( { Name: "email", Value: input.account } );
        else              attributes.push( { Name: "phone_number", Value: input.account } );

        const signUp = await this.cognito.client.send( new SignUpCommand( {
            ClientId:       await this.clientId(),
            Username:       input.account,
            Password:       input.password,
            UserAttributes: attributes,
        } ) );

        const userId : string = signUp.UserSub ?? "";
        const now : string = new Date().toISOString();
        await this.dynamo.put( UserStore.USERS, {
            userId,
            email:         emailMethod ? input.account : undefined,
            phone:         emailMethod ? undefined : input.account,
            emailVerified: false,
            phoneVerified: false,
            firstName:     input.firstName,
            lastName:      input.lastName,
            accountName:   input.accountName,
            status:        User.Status.PENDING,
            createdAt:     now,
            modifiedAt:    now,
        } );

        return { userId, verify: emailMethod ? "email" : "phone" };
    }

    /** Confirm a registration code; flips the `users` row to ACTIVE and returns the activated profile
     *  (so the caller can publish the `auth.user.created` event that provisions the account). */
    public async confirmRegister( account : string, code : string ) : Promise<UserStore.Confirmed>
    {
        await this.cognito.client.send( new ConfirmSignUpCommand( { ClientId: await this.clientId(), Username: account, ConfirmationCode: code } ) );
        const sub : string | undefined = await this.subOf( account );

        let profile : Record<string, unknown> = { userId: sub ?? account, createdAt: new Date().toISOString() };
        if( sub )
        {
            const row = ( await this.dynamo.get<Record<string, unknown>>( UserStore.USERS, { userId: sub } ) );
            const existing : Record<string, unknown> = ( row.ok && row.data ) ? row.data : profile;
            profile = { ...existing, status: User.Status.ACTIVE, emailVerified: true, modifiedAt: new Date().toISOString() };
            await this.dynamo.put( UserStore.USERS, profile );
        }

        return {
            userId:      String( profile.userId ?? sub ?? account ),
            email:       profile.email ? String( profile.email ) : undefined,
            phone:       profile.phone ? String( profile.phone ) : undefined,
            firstName:   String( profile.firstName   ?? "" ),
            lastName:    String( profile.lastName    ?? "" ),
            accountName: String( profile.accountName ?? "" ),
        };
    }

    /** Re-send the registration verification code. */
    public async resendCode( account : string ) : Promise<void>
    {
        await this.cognito.client.send( new ResendConfirmationCodeCommand( { ClientId: await this.clientId(), Username: account } ) );
    }

    // ── lookups ─────────────────────────────────────────────────────────────────────────────────

    /** Does a user exist for this email and/or phone? (Cognito is authoritative for both.) */
    public async exists( email? : string, phone? : string ) : Promise<UserStore.Existence>
    {
        const emailTaken : boolean = email ? await this.anyMatch( `email = "${email}"` ) : false;
        const phoneTaken : boolean = phone ? await this.anyMatch( `phone_number = "${phone}"` ) : false;
        return { exists: emailTaken || phoneTaken, emailTaken, phoneTaken };
    }

    private async anyMatch( filter : string ) : Promise<boolean>
    {
        const page = await this.cognito.client.send( new ListUsersCommand( { UserPoolId: this.poolId, Filter: filter, Limit: 1 } ) );
        return ( page.Users?.length ?? 0 ) > 0;
    }

    /** Admin user search. Filters (all optional) AND together; returns composed `User.Entity` rows. */
    public async list( filters : UserStore.ListFilters ) : Promise<User.Entity[]>
    {
        const filter : string | undefined =
              filters.email     ? `email ^= "${filters.email}"`
            : filters.phone     ? `phone_number ^= "${filters.phone}"`
            : filters.firstName ? `given_name ^= "${filters.firstName}"`
            : filters.lastName  ? `family_name ^= "${filters.lastName}"`
            : undefined;

        const page = await this.cognito.client.send( new ListUsersCommand( { UserPoolId: this.poolId, Filter: filter, Limit: 60 } ) );
        const users : User.Entity[] = [];
        for( const user of page.Users ?? [] ) users.push( await this.compose( user ) );
        return users;
    }

    /** Compose a `User.Entity` for one user id (sub) — Cognito attributes ⊕ the DynamoDB row. */
    public async profile( userId : string ) : Promise<User.Entity | undefined>
    {
        const got = await this.cognito.getUser( UserStore.POOL, userId );
        if( !got.ok ) return undefined;
        const attrs : Record<string, string> = attrsToRecord( got.data.UserAttributes );
        return this.entityFrom( attrs, got.data.Username ?? userId, got.data.Enabled ?? true, got.data.UserStatus );
    }

    // ── user metadata (DynamoDB) ──────────────────────────────────────────────────────────────────

    /** The caller's metadata, filtered by id and/or type. */
    public async metaList( userId : string, id? : string, type? : string ) : Promise<UserMeta.Entity[]>
    {
        if( id )
        {
            const got = await this.dynamo.get<MetaRow>( UserStore.USER_META, { userId, sk: id } );
            const row : MetaRow | undefined = got.ok ? got.data : undefined;
            return row && ( !type || row.type === type ) ? [ toMeta( row ) ] : [];
        }
        const res = await this.dynamo.query<MetaRow>( UserStore.USER_META, {
            KeyConditionExpression:    "userId = :u",
            ExpressionAttributeValues: { ":u": userId },
        } );
        const rows : MetaRow[] = res.ok ? res.data : [];
        return rows.filter( ( row : MetaRow ) => !type || row.type === type ).map( toMeta );
    }

    /** Upsert a meta record (server mints the id on create). Returns the saved record. */
    public async metaPut( userId : string, type : string, object : unknown, id? : string ) : Promise<UserMeta.Entity>
    {
        const recordId : string = id && id !== "" ? id : randomUUID();
        await this.dynamo.put( UserStore.USER_META, { userId, sk: recordId, id: recordId, type, object } );
        return { id: recordId, type, object: object as UserMeta.Entity[ "object" ] };
    }

    /** Delete a meta record by id. */
    public async metaDelete( userId : string, id : string ) : Promise<void>
    {
        await this.dynamo.remove( UserStore.USER_META, { userId, sk: id } );
    }

    // ── password reset (Cognito) ──────────────────────────────────────────────────────────────────

    public async forgotPassword( account : string ) : Promise<void>
    {
        await this.cognito.client.send( new ForgotPasswordCommand( { ClientId: await this.clientId(), Username: account } ) );
    }

    public async resetPassword( account : string, code : string, newPassword : string ) : Promise<void>
    {
        await this.cognito.client.send( new ConfirmForgotPasswordCommand( { ClientId: await this.clientId(), Username: account, ConfirmationCode: code, Password: newPassword } ) );
    }

    // ── internals ────────────────────────────────────────────────────────────────────────────────

    /** The Cognito sub for a username/alias (AdminGetUser → the `sub` attribute). */
    private async subOf( username : string ) : Promise<string | undefined>
    {
        try
        {
            const response = await this.cognito.client.send( new AdminGetUserCommand( { UserPoolId: this.poolId, Username: username } ) );
            return attrsToRecord( response.UserAttributes )[ "sub" ] ?? response.Username;
        }
        catch { return undefined; }
    }

    /** Map a ListUsers row → composed entity (merges the DynamoDB row for status/icon/timestamps). */
    private async compose( user : UserType ) : Promise<User.Entity>
    {
        const attributes : Record<string, string> = attrsToRecord( user.Attributes );
        return this.entityFrom( attributes, user.Username ?? "", user.Enabled ?? true, user.UserStatus );
    }

    private async entityFrom( attrs : Record<string, string>, username : string, _enabled : boolean, cognitoStatus? : string ) : Promise<User.Entity>
    {
        const userId : string = attrs[ "sub" ] ?? username;
        const got = await this.dynamo.get<Record<string, string>>( UserStore.USERS, { userId } );
        const row : Record<string, string> = ( got.ok && got.data ) ? got.data : {};

        const status : User.Status = ( row.status as User.Status ) ?? mapStatus( cognitoStatus );
        return {
            id:            userId,
            email:         attrs[ "email" ] || undefined,
            phone:         attrs[ "phone_number" ] || undefined,
            emailVerified: attrs[ "email_verified" ] === "true",
            phoneVerified: attrs[ "phone_number_verified" ] === "true",
            firstName:     attrs[ "given_name" ] ?? "",
            lastName:      attrs[ "family_name" ] ?? "",
            displayName:   attrs[ "name" ] || undefined,
            avatarUrl:     attrs[ "picture" ] || undefined,
            icon:          row.icon || undefined,
            locale:        attrs[ "locale" ] || undefined,
            timezone:      attrs[ "zoneinfo" ] || undefined,
            status,
            mfa:           { enabled: false, methods: [] },
            lastLoginAt:   row.lastLoginAt || undefined,
            createdAt:     row.createdAt || new Date( 0 ).toISOString(),
            modifiedAt:    row.modifiedAt || new Date( 0 ).toISOString(),
        };
    }
}

export namespace UserStore
{
    export interface Tokens { accessToken : string; idToken? : string; refreshToken? : string; expiresIn? : number; }
    export interface LoginResult { complete : boolean; tokens? : Tokens; challenge? : string; }
    export interface RegisterInput { method : string; account : string; firstName : string; lastName : string; accountName : string; password : string; }
    export interface Registered { userId : string; verify : string; }
    /** The activated profile returned by confirmRegister — the payload for the auth.user.created event. */
    export interface Confirmed { userId : string; email? : string; phone? : string; firstName : string; lastName : string; accountName : string; }
    export interface Existence { exists : boolean; emailTaken : boolean; phoneTaken : boolean; }
    export interface ListFilters { accountId? : string; email? : string; phone? : string; firstName? : string; lastName? : string; }
}

export default UserStore;


// ── module helpers ──────────────────────────────────────────────────────────────────────────────
interface MetaRow { userId : string; sk : string; id : string; type : string; object : unknown; }

function toMeta( row : MetaRow ) : UserMeta.Entity { return { id: row.id, type: row.type, object: row.object as UserMeta.Entity[ "object" ] }; }

function attrsToRecord( list? : AttributeType[] ) : Record<string, string>
{
    const record : Record<string, string> = {};
    ( list ?? [] ).forEach( ( attribute : AttributeType ) => { if( attribute.Name ) record[ attribute.Name ] = attribute.Value ?? ""; } );
    return record;
}

function mapStatus( cognitoStatus? : string ) : User.Status
{
    switch( cognitoStatus )
    {
        case "CONFIRMED":             return User.Status.ACTIVE;
        case "FORCE_CHANGE_PASSWORD":
        case "RESET_REQUIRED":        return User.Status.RESET_REQUIRED;
        case "UNCONFIRMED":           return User.Status.PENDING;
        default:                      return User.Status.PENDING;
    }
}
