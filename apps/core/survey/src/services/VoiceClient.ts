//
import { NetworkUtils, ResultUtils, type Type } from "@repo/common";
import { RestfulService } from "@repo/endpoint";
import { Ports } from "@repo/cloud-manifest";
import { PostVoiceInternalFlow, PostVoiceCalls, Voice } from "@repo/api";
import { PhoneRunner } from "../runners/PhoneRunner";

//
// VoiceClient — the S2S client to voice's internal flow-create + call-enqueue endpoints (same pattern as
// apps/core/texting/src/clients/ContactClient.ts). Creates the compiled IVR flow (survey-2.4) once per
// distribution and places one call per recipient, carrying the survey's PURL/submission token in `mergeData`
// so voice's `voice.call` UPDATED event (emitted per DTMF answer — see VoiceService.ivrFlowStep) can be
// traced back to the right Response without voice ever importing survey's model.
//
export class VoiceClient
{
    private readonly client : RestfulService;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        this.client = new RestfulService(
            process.env.VOICE_INTERNAL_URL ?? NetworkUtils.url( NetworkUtils.Protocol.HTTP, "localhost", Ports.VOICE.MAIN, null, null ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Create the IVR flow for a distribution (once — the caller persists the returned id on
     *  `Distribution.flowId` and reuses it for every recipient). */
    public async createFlow( accountId : Type.ID, name : string, compiled : PhoneRunner.CompiledFlow ) : Promise<Type.Result<string>>
    {
        const reply : RestfulService.Reply<PostVoiceInternalFlow.Response> = await this.client.fetch(
            new PostVoiceInternalFlow( { accountId, name, entryStepId: compiled.entryStepId, steps: compiled.steps as unknown as Record<string, Voice.IvrStep> } ) );
        if( !reply.ok ) return ResultUtils.err( `voice internal flow create failed (${ reply.status })` );
        return ResultUtils.ok( ( reply.data as PostVoiceInternalFlow.Response ).id );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Place one outbound IVR call for a single recipient, carrying the survey's submission token. */
    public async placeCall( accountId : Type.ID, to : string, callerId : string, flowId : string, surveyToken : string ) : Promise<Type.Result<void>>
    {
        const reply : RestfulService.Reply<PostVoiceCalls.Response> = await this.client.fetch(
            new PostVoiceCalls( { accountId, to: [ to ], callerId, flowId, mergeData: { surveyToken } } ) );
        if( !reply.ok ) return ResultUtils.err( `voice call enqueue failed (${ reply.status })` );
        return ResultUtils.ok( undefined );
    }
}

export default VoiceClient;
// eof
