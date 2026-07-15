//
import { randomUUID } from "crypto";

import {
    generateRegistrationOptions, verifyRegistrationResponse,
    generateAuthenticationOptions, verifyAuthenticationResponse,
    type VerifiedRegistrationResponse, type VerifiedAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
    PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON,
    RegistrationResponseJSON, AuthenticationResponseJSON, AuthenticatorTransportFuture,
} from "@simplewebauthn/server";

import type { Dynamo } from "@repo/services";
import type { Type } from "@repo/common";
import { ResultUtils } from "@repo/common";

//
// PasskeyStore — WebAuthn (FIDO2) ceremonies via @simplewebauthn/server, backed by DynamoDB. Stores
// registered credentials in the `passkeys` table (PK credentialId, GSI userId) and the short-lived
// ceremony challenge in `webauthn_challenges` (PK ceremonyId, TTL). Credential public keys are stored
// base64url-encoded (binary-safe through the DocumentClient).
//
// Relying-Party config (rpID / origin) comes from env — defaults target localhost dev. WebAuthn requires
// rpID to match the site's domain and origin to match exactly, so set WEBAUTHN_ORIGIN/WEBAUTHN_RP_ID per
// environment.
//
export class PasskeyStore
{
    private static readonly PASSKEYS : string = "passkeys";
    private static readonly CHALLENGES : string = "webauthn_challenges";
    private static readonly CHALLENGE_TTL_SECONDS : number = 300;   // 5 min

    constructor( private readonly dynamo : Dynamo ) {}

    private get rpName() : string { return process.env.WEBAUTHN_RP_NAME ?? "RumbleUp"; }
    private get rpID()   : string { return process.env.WEBAUTHN_RP_ID ?? "localhost"; }
    private get origin() : string { return process.env.WEBAUTHN_ORIGIN ?? "http://localhost:5173"; }

    // ── registration (enrol a passkey — authenticated user) ──────────────────────────────────────

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Begin registration: options for the browser + a ceremonyId that threads the stored challenge. */
    public async registrationOptions( userId : string, username : string ) : Promise<PasskeyStore.OptionsResult<PublicKeyCredentialCreationOptionsJSON>>
    {
        const existing : Array<PasskeyStore.CredentialRow> = await this.credentialsOf( userId );
        const options : PublicKeyCredentialCreationOptionsJSON = await generateRegistrationOptions( {
            rpName:    this.rpName,
            rpID:      this.rpID,
            userName:  username,
            userID:    new Uint8Array( Buffer.from( userId, "utf-8" ) ),
            attestationType: "none",
            excludeCredentials: existing.map( ( c : PasskeyStore.CredentialRow ) => ( { id: c.credentialId, transports: c.transports } ) ),
            authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
        } );

        const ceremonyId : string = await this.storeChallenge( options.challenge, "register", userId );
        return { ceremonyId, options };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Verify the attestation; on success persist the credential. Returns the new credential id. */
    public async registrationVerify( ceremonyId : string, response : Record<string, unknown>, userId : string ) : Promise<string>
    {
        const taken : Type.Result<PasskeyStore.Challenge> = await this.takeChallenge( ceremonyId, "register" );
        if( !taken.ok ) throw new Error( taken.error );
        const challenge : PasskeyStore.Challenge = taken.data;
        if( challenge.userId !== userId ) throw new Error( "ceremony does not belong to this user" );

        const verification : VerifiedRegistrationResponse = await verifyRegistrationResponse( {
            response: response as unknown as RegistrationResponseJSON,
            expectedChallenge: challenge.challenge,
            expectedOrigin:    this.origin,
            expectedRPID:      this.rpID,
        } );
        if( !verification.verified || !verification.registrationInfo ) throw new Error( "registration not verified" );

        const credential = verification.registrationInfo.credential;
        const row : PasskeyStore.CredentialRow = {
            credentialId: credential.id,
            userId,
            publicKey:    Buffer.from( credential.publicKey ).toString( "base64url" ),
            counter:      credential.counter,
            transports:   credential.transports,
            createdAt:    new Date().toISOString(),
        };
        await this.dynamo.put( PasskeyStore.PASSKEYS, row as unknown as Record<string, unknown> );
        return credential.id;
    }

    // ── authentication (sign in with a passkey — public) ─────────────────────────────────────────

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Begin authentication: discoverable-credential options + a ceremonyId. */
    public async authenticationOptions() : Promise<PasskeyStore.OptionsResult<PublicKeyCredentialRequestOptionsJSON>>
    {
        const options : PublicKeyCredentialRequestOptionsJSON = await generateAuthenticationOptions( {
            rpID:             this.rpID,
            userVerification: "preferred",
        } );
        const ceremonyId : string = await this.storeChallenge( options.challenge, "auth" );
        return { ceremonyId, options };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Verify the assertion against the stored credential. NEVER throws — returns a `Type.Result<string>`
     * (the owning userId on success, or an `error` the caller maps to 401). All failure paths (expired
     * ceremony, unknown credential, failed verification, malformed assertion from the library) are
     * captured into the Result via ResultUtils.from.
     */
    public async authenticationVerify( ceremonyId : string, response : Record<string, unknown> ) : Promise<Type.Result<string>>
    {
        return ResultUtils.from( async () : Promise<string> =>
        {
            const taken : Type.Result<PasskeyStore.Challenge> = await this.takeChallenge( ceremonyId, "auth" );
            if( !taken.ok ) throw new Error( taken.error );   // captured by ResultUtils.from → err Result
            const challenge : PasskeyStore.Challenge = taken.data;

            const assertion : AuthenticationResponseJSON = response as unknown as AuthenticationResponseJSON;
            const got : Type.Result<PasskeyStore.CredentialRow | undefined> = await this.dynamo.get<PasskeyStore.CredentialRow>( PasskeyStore.PASSKEYS, { credentialId: assertion.id } );
            const row : PasskeyStore.CredentialRow | undefined = got.ok ? got.data : undefined;
            if( !row ) throw new Error( "unknown credential" );

            const verification : VerifiedAuthenticationResponse = await verifyAuthenticationResponse( {
                response: assertion,
                expectedChallenge: challenge.challenge,
                expectedOrigin:    this.origin,
                expectedRPID:      this.rpID,
                credential: {
                    id:         row.credentialId,
                    publicKey:  new Uint8Array( Buffer.from( row.publicKey, "base64url" ) ),
                    counter:    row.counter,
                    transports: row.transports,
                },
            } );
            if( !verification.verified ) throw new Error( "authentication not verified" );

            // persist the new signature counter (replay defence)
            await this.dynamo.put( PasskeyStore.PASSKEYS, { ...row, counter: verification.authenticationInfo.newCounter } as unknown as Record<string, unknown> );
            return row.userId;
        } );
    }

    // ── management (list / remove — the signed-in user's own credentials) ─────────────────────────

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /** The caller's enrolled passkeys (no public-key material). */
    public async list( userId : string ) : Promise<Array<PasskeyStore.CredentialSummary>>
    {
        const rows : Array<PasskeyStore.CredentialRow> = await this.credentialsOf( userId );
        return rows.map( ( row : PasskeyStore.CredentialRow ) => ( {
            credentialId: row.credentialId,
            transports:   row.transports,
            createdAt:    row.createdAt,
        } ) );
    }

    /** Remove one of the caller's passkeys. Returns false if it isn't theirs (or doesn't exist). */
    public async remove( userId : string, credentialId : string ) : Promise<boolean>
    {
        const got : Type.Result<PasskeyStore.CredentialRow | undefined> = await this.dynamo.get<PasskeyStore.CredentialRow>( PasskeyStore.PASSKEYS, { credentialId } );
        const row : PasskeyStore.CredentialRow | undefined = got.ok ? got.data : undefined;
        if( !row || row.userId !== userId ) return false;   // not found / not the caller's

        await this.dynamo.remove( PasskeyStore.PASSKEYS, { credentialId } );
        return true;
    }

    // ── internals ────────────────────────────────────────────────────────────────────────────────

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    private async credentialsOf( userId : string ) : Promise<Array<PasskeyStore.CredentialRow>>
    {
        const result : Type.Result<Array<PasskeyStore.CredentialRow>> = await this.dynamo.query<PasskeyStore.CredentialRow>( PasskeyStore.PASSKEYS, {
            IndexName:                 "userId",
            KeyConditionExpression:    "userId = :u",
            ExpressionAttributeValues: { ":u": userId },
        } );
        return result.ok ? result.data : [];
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    private async storeChallenge( challenge : string, kind : PasskeyStore.Kind, userId? : string ) : Promise<string>
    {
        const ceremonyId : string = randomUUID();
        const expiresAt : number = Math.floor( Date.now() / 1000 ) + PasskeyStore.CHALLENGE_TTL_SECONDS;
        await this.dynamo.put( PasskeyStore.CHALLENGES, { ceremonyId, challenge, kind, userId, expiresAt } );
        return ceremonyId;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Consume (single-use) the stored challenge for a ceremony. NEVER throws — returns a `Type.Result`
     *  (the challenge on success, or an `error` for an unknown / wrong-kind / expired ceremony). */
    private async takeChallenge( ceremonyId : string, kind : PasskeyStore.Kind ) : Promise<Type.Result<PasskeyStore.Challenge>>
    {
        const got : Type.Result<PasskeyStore.Challenge | undefined> = await this.dynamo.get<PasskeyStore.Challenge>( PasskeyStore.CHALLENGES, { ceremonyId } );
        const challenge : PasskeyStore.Challenge | undefined = got.ok ? got.data : undefined;
        if( !challenge || challenge.kind !== kind ) return ResultUtils.err( "invalid or expired ceremony" );
        if( challenge.expiresAt < Math.floor( Date.now() / 1000 ) ) return ResultUtils.err( "ceremony expired" );
        await this.dynamo.remove( PasskeyStore.CHALLENGES, { ceremonyId } );   // single-use
        return ResultUtils.ok( challenge );
    }
}

export namespace PasskeyStore
{
    export type Kind = "register" | "auth";

    export interface OptionsResult<T> { ceremonyId : string; options : T; }

    export interface CredentialRow
    {
        credentialId : string;
        userId       : string;
        publicKey    : string;   // base64url-encoded COSE public key
        counter      : number;
        transports?  : Array<AuthenticatorTransportFuture>;
        createdAt    : string;
    }

    export interface Challenge { ceremonyId : string; challenge : string; kind : Kind; userId? : string; expiresAt : number; }

    /** Public-safe view of a credential (no public key). */
    export interface CredentialSummary { credentialId : string; transports? : Array<AuthenticatorTransportFuture>; createdAt : string; }
}

export default PasskeyStore;
