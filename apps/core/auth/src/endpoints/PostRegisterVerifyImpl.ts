//
import { randomUUID } from 'node:crypto';

import { PostRegisterVerify } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import { Events } from '@repo/system';
import AuthService from '../services/AuthService';
import type UserStore from '../services/UserStore';
import { authError, type AuthFailure } from './AuthErrors';

//
// Confirm the registration code (Cognito ConfirmSignUp) → activate the account. No session is issued
// here (we don't hold the password); the client signs in next.
//
export class PostRegisterVerifyImpl extends PostRegisterVerify
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
        try
        {
            const confirmed : UserStore.Confirmed = await this.service.users.confirmRegister( this.body!.registrationToken, this.body!.code );
            await this.publishUserCreated( confirmed );
            const reply : PostRegisterVerify.Response = { complete: true };
            return { status: NetworkUtils.Status.OK, data: reply };
        }
        catch( err )
        {
            const failure : AuthFailure = authError( err );
            return { status: failure.status, data: { message: failure.message } };
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Publish auth.user.created — the account service consumes this to provision the account + membership,
    // then emits account.account.created. Best-effort: the verification has already succeeded, so a bus
    // outage must not fail the request (publishEvent returns a self-contained Result and never throws).
    // No account exists yet, so the envelope's tenant scope is the userId; account.created carries the
    // real accountId once the account service mints it.
    private async publishUserCreated( user : UserStore.Confirmed ) : Promise<void>
    {
        const now : string = new Date().toISOString();
        const envelope : Events.Envelope =
        {
            version:    "1",
            eventId:    randomUUID(),
            occurredAt: now,
            accountId:  user.userId,
            actor:      { kind: Events.ActorKind.USER, id: user.userId },
            object:     Events.Object.AUTH_USER,
            verb:       Events.Verb.CREATED,
            action:     Events.actionOf( Events.Object.AUTH_USER, Events.Verb.CREATED ),
            target:     { type: "user", id: user.userId },
            source:     { channel: Events.SourceChannel.API },
            outcome:    Events.Outcome.SUCCESS,
            data:       user,
            sinks:      [ Events.Sink.KAFKA ],
        };
        await this.service.kafka.publishEvent( envelope );
    }
}

export default PostRegisterVerifyImpl;
