//
import { randomUUID } from "node:crypto";

import { PostVoiceInternalFlow, Voice } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events } from "@repo/system";

import VoiceService from "../services/VoiceService";

//
// S2S: create an IVR flow on behalf of an account — no user session, caller passes `accountId` explicitly.
// Same validation as PostVoiceFlowImpl (entryStepId resolves + every branch target exists).
//
export class PostVoiceInternalFlowImpl extends PostVoiceInternalFlow
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostVoiceInternalFlow.Body | null = this.body;
        if( !body?.accountId || !body.name || !body.entryStepId || !body.steps )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId, name, entryStepId, and steps are required" } };

        const invalid : string | undefined = VoiceService.validateFlow( body.entryStepId, body.steps );
        if( invalid !== undefined ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: invalid } };

        const now : string = new Date().toISOString();
        const flow : Voice.IvrFlow = {
            id: randomUUID(), accountId: body.accountId, name: body.name, entryStepId: body.entryStepId, steps: body.steps,
            createdAt: now, updatedAt: now,
        };

        const wrote : Type.Result<void> = await this.service.putFlow( flow );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not save the flow" } };
        await this.service.emitFlow( Events.Verb.CREATED, flow );
        return { status: NetworkUtils.Status.OK, data: flow };
    }
}

export default PostVoiceInternalFlowImpl;
// eof
