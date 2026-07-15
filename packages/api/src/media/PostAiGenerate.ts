//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { AiRouting } from "../ai/model/AiRouting";
import { AiGen } from "../ai/model/AiGen";

// Generate a NEW media asset from a prompt (media-18). The service resolves the modality's provider from the
// account's `config/ai` routing (or the request override), calls the AI factory, saves the bytes as a normal
// Media.Asset with `source.origin = generated` (prompt/params retained), and returns a preview. The client
// then sets name/tags (PatchAsset) to keep it, or deletes it to discard.
export class PostAiGenerate extends RestfulEndpoint<{}, PostAiGenerate.Body, PostAiGenerate.Response>
{
    public readonly uri      : string = PostAiGenerate.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostAiGenerate.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, required: [ "modality", "prompt" ], properties: {
            modality: { type: "string", enum: Object.values( AiRouting.Modality ) },
            prompt:   { type: "string", minLength: 1 },
            provider: { type: "string", enum: Object.values( AiRouting.Provider ) },
            model:    { type: "string" },
            params:   { type: "object" },   // normalized attribute values (validated loosely; mapped in the impl)
            count:    { type: "number", minimum: 1, maximum: 10 },   // candidate solutions (clamped server-side)
        } };
    }
}

export namespace PostAiGenerate
{
    export const URI : string = apiPath( "media", 1, "/generate" );
    export interface Body extends RestfulEndpoint.AuthRequest, AiGen.Request {}
    export interface Response extends AiGen.Response {}
    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_AVAILABLE         = NetworkUtils.Status.NOT_IMPLEMENTED,   // no provider/adapter for the modality
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostAiGenerate;
