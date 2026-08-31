//
import { PatchVoiceFlow, Voice } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events } from "@repo/system";

import VoiceService from "../services/VoiceService";

//
// Update an IVR flow's name / entry step / step graph (voice-2.1). Re-validates the step graph against
// whichever of entryStepId/steps changed (falling back to the stored values for the field(s) not patched).
//
export class PatchVoiceFlowImpl extends PatchVoiceFlow
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const found : Type.Result<Voice.IvrFlow | undefined> = await this.service.getFlow( auth.accountId, this.query.id );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not read the flow" } };
        if( found.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "flow not found" } };

        const body : PatchVoiceFlow.Body | null = this.body;
        const entryStepId : string = body?.entryStepId ?? found.data.entryStepId;
        const steps : Record<string, Voice.IvrStep> = body?.steps ?? found.data.steps;

        const invalid : string | undefined = VoiceService.validateFlow( entryStepId, steps );
        if( invalid !== undefined ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: invalid } };

        const flow : Voice.IvrFlow = {
            ...found.data, name: body?.name ?? found.data.name, entryStepId, steps,
            updatedAt: new Date().toISOString(), updatedBy: auth.userId,
        };

        const wrote : Type.Result<void> = await this.service.putFlow( flow );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not save the flow" } };
        await this.service.emitFlow( Events.Verb.UPDATED, flow );
        return { status: NetworkUtils.Status.OK, data: { flow } };
    }
}

export default PatchVoiceFlowImpl;
// eof
