//
import { randomUUID } from "node:crypto";

import { PostVoiceFlow, Voice } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events } from "@repo/system";

import VoiceService from "../services/VoiceService";

//
// Create an IVR flow (voice-2.1). Validates the step graph (entryStepId resolves + every branch target exists)
// before persisting.
//
export class PostVoiceFlowImpl extends PostVoiceFlow
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PostVoiceFlow.Body | null = this.body;
        if( !body || !body.name || !body.entryStepId || !body.steps )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "name, entryStepId, and steps are required" } };

        const invalid : string | undefined = VoiceService.validateFlow( body.entryStepId, body.steps );
        if( invalid !== undefined ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: invalid } };

        const now : string = new Date().toISOString();
        const flow : Voice.IvrFlow = {
            id: randomUUID(), accountId: auth.accountId, name: body.name, entryStepId: body.entryStepId, steps: body.steps,
            createdAt: now, createdBy: auth.userId, updatedAt: now, updatedBy: auth.userId,
        };

        const wrote : Type.Result<void> = await this.service.putFlow( flow );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not save the flow" } };
        await this.service.emitFlow( Events.Verb.CREATED, flow );
        return { status: NetworkUtils.Status.OK, data: flow };
    }
}

export default PostVoiceFlowImpl;
// eof
