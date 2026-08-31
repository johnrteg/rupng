//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

//
// S2S: store raw bytes as a new media asset directly (bypasses the browser presigned-upload flow — there's no
// acting user to presign for). Writes straight to the `media` bucket/table (the same shape `promoteBatch`
// uses for AI-generated candidates), enters the normal scan→process pipeline (`media-scan`), and returns a
// short-lived presigned playback URL for IMMEDIATE use — the caller doesn't have to wait for the scan to
// finish before playing back what it just uploaded (the bytes are already in S3; only the async pipeline's
// derived variants/metadata are still pending). First consumer: voice's synthesized-TTS cache, so other
// services (and operators, via the asset library UI) can see/reuse it — see apps/core/voice/SPECS.md.
//
export class PostInternalAsset extends RestfulEndpoint< {}, PostInternalAsset.Body, PostInternalAsset.Response >
{
    public readonly uri      : string = PostInternalAsset.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "storeInternalAsset",
        summary:     "Store bytes as a media asset (S2S)",
        description: "Stores raw bytes (base64) as a new asset in the account's library and returns a short-lived playback URL.",
        tags:        [ "Media" ],
    };

    constructor( body? : PostInternalAsset.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "accountId", "name", "kind", "mime", "extension", "data" ],
            properties: {
                accountId: { type: "string" },
                name:      { type: "string", minLength: 1 },
                kind:      { type: "string", enum: Object.values( Media.Kind ) },
                mime:      { type: "string" },
                extension: { type: "string" },
                data:      { type: "string", description: "base64-encoded bytes" },
                tags:      { type: "array", items: { type: "string" } },
                source:    { type: "object" },
            },
        };
    }
}

export namespace PostInternalAsset
{
    export const URI : string = apiPath( "media", 1, "/internal/assets" );
    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        accountId : string;
        name      : string;
        kind      : Media.Kind;
        mime      : string;
        extension : string;
        data      : string;         // base64-encoded bytes
        tags?     : Array<string>;
        source?   : Media.Source;
    }
    export interface Response { asset : Media.Asset; url : string; expiresAt : string; }
    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostInternalAsset;
// eof
