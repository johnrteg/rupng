//
import { PostVoiceFlowPreview } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import VoiceService from "../services/VoiceService";

//
// Preview one step of a saved IVR flow (voice-2.2) — merge + (for TTS) synthesize, no call placed.
//
export class PostVoiceFlowPreviewImpl extends PostVoiceFlowPreview
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PostVoiceFlowPreview.Body | null = this.body;
        const preview : VoiceService.FlowPreview | undefined = await this.service.previewStep( auth.accountId, this.query.id, body?.stepId, body?.mergeData );
        if( preview === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "flow or step not found" } };
        return { status: NetworkUtils.Status.OK, data: preview };
    }
}

export default PostVoiceFlowPreviewImpl;
// eof
