//
import { PostVoiceInternalErase } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import VoiceService from "../services/VoiceService";

//
// S2S forget hook (voice-9.0) — the `contact` forget fan-out calls this to erase a destination's recordings +
// transcripts ahead of the bucket-lifecycle TTL.
//
export class PostVoiceInternalEraseImpl extends PostVoiceInternalErase
{
    private service : VoiceService;
    constructor( service : VoiceService ) { super(); this.service = service; }

    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostVoiceInternalErase.Body | null = this.body;
        if( !body || !body.accountId || !body.to ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId and to are required" } };

        const erased : Type.Result<number> = await this.service.eraseContact( body.accountId, body.to );
        if( !erased.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "erase failed" } };
        return { status: NetworkUtils.Status.OK, data: { erased: erased.data } };
    }
}

export default PostVoiceInternalEraseImpl;
// eof
