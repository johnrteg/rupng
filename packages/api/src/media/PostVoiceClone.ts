//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// Clone a voice (media-21) from an account AUDIO asset via the SPEECH_CLONING provider's voice-clone
// capability. The result is an ACCOUNT-scoped Media.Voice (never cross-account). Returns the created voice.
export class PostVoiceClone extends RestfulEndpoint<{}, PostVoiceClone.Body, PostVoiceClone.Response>
{
    public readonly uri      : string = PostVoiceClone.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostVoiceClone.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, required: [ "sourceGuid", "name" ], properties: {
            sourceGuid: { type: "string", minLength: 1 },   // an account AUDIO asset to clone from
            name:       { type: "string", minLength: 1, maxLength: 120 },
        } };
    }
}

export namespace PostVoiceClone
{
    export const URI : string = apiPath( "media", 1, "/voices" );
    export interface Body extends RestfulEndpoint.AuthRequest { sourceGuid : string; name : string; }
    export interface Response { voice : Media.Voice; }
    export enum Error
    {
        BAD_REQUEST   = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED  = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND     = NetworkUtils.Status.NOT_FOUND,
        CONFLICT      = NetworkUtils.Status.CONFLICT,        // not an audio asset
        NOT_AVAILABLE = NetworkUtils.Status.NOT_IMPLEMENTED, // no clone-capable provider configured
    }
}

export default PostVoiceClone;
