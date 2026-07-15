//
// Bedrock adapter — the default. IAM-authed (no API key), Claude on Bedrock via InvokeModel.
// Body/response use the Anthropic Messages format that Bedrock's anthropic.* models expect.
//
import { BedrockRuntimeClient, InvokeModelCommand, StartAsyncInvokeCommand, GetAsyncInvokeCommand } from "@aws-sdk/client-bedrock-runtime";
import type { InvokeModelCommandOutput, StartAsyncInvokeCommandOutput, GetAsyncInvokeCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";

import { Ai } from "../AiModel";
import { BaseAdapter, AdapterOptions, Attempt } from "./BaseAdapter";

/** Internal shape of an Anthropic-on-Bedrock InvokeModel response body. */
interface ClaudeBody
{
    /** Reply content blocks (text parts are concatenated). */
    content?     : Array<{ type : string; text : string }>;
    /** Provider stop reason. */
    stop_reason? : string;
    /** Token usage. */
    usage?       : { input_tokens? : number; output_tokens? : number };
}

/** Internal shape of a Titan / Nova image-generation InvokeModel response (base64 images). */
interface TitanImageBody { images? : Array<string>; error? : string; }

/**
 * The default adapter: **AWS Bedrock**, IAM-authed (no API key), invoking Claude via `InvokeModel`.
 * Request/response use the Anthropic Messages format Bedrock's `anthropic.*` models expect.
 * Supports {@link Ai.Capability.CHAT} and {@link Ai.Capability.STRUCTURED} (the latter via the base).
 */
export class BedrockAdapter extends BaseAdapter
{
    /** @inheritDoc */
    readonly provider     : Ai.Provider = Ai.Provider.BEDROCK;
    /** Chat + structured + image + video (no key needed — Bedrock uses IAM). */
    readonly capabilities : ReadonlySet<Ai.Capability> = new Set<Ai.Capability>( [ Ai.Capability.CHAT, Ai.Capability.STRUCTURED, Ai.Capability.IMAGE, Ai.Capability.VIDEO ] );

    /** Image model (independent of the chat `model`) — Amazon Titan Image Generator on Bedrock. */
    private static readonly IMAGE_MODEL : string = "amazon.titan-image-generator-v1";
    /** Video model — Amazon Nova Reel (async invoke → S3). */
    private static readonly VIDEO_MODEL : string = "amazon.nova-reel-v1:0";
    /** Max time to wait for an async video job (poll loop), and the poll interval. */
    private static readonly VIDEO_TIMEOUT_MS : number = 8 * 60 * 1000;
    private static readonly VIDEO_POLL_MS    : number = 10 * 1000;

    /** The Bedrock runtime client (IAM-authed via the ambient AWS credentials). */
    private readonly client : BedrockRuntimeClient;
    /** S3 client to read an async video job's output (same IAM/region as Bedrock). */
    private readonly s3 : S3Client;
    /** The AWS region + S3 output bucket for async video (Nova Reel writes the mp4 there). */
    private readonly region : string;
    private readonly videoBucket? : string;

    /** @param opts adapter options; `model` defaults to Claude 3.5 Sonnet on Bedrock. */
    constructor( opts : AdapterOptions = {} )
    {
        super( opts, "anthropic.claude-3-5-sonnet-20240620-v1:0" );
        this.region = opts.region ?? process.env.AWS_REGION ?? "us-east-1";
        this.videoBucket = opts.videoBucket;
        this.client = new BedrockRuntimeClient( { region: this.region } );
        this.s3 = new S3Client( { region: this.region, forcePathStyle: true } );
    }

    /**
     * Invoke the model with the conversation and return the text reply. The leading system turns are
     * sent via Bedrock's separate `system` field; user/assistant turns become `messages`.
     */
    override async chat( request : Ai.ChatRequest ) : Promise<Ai.ChatResponse>
    {
        this.require( Ai.Capability.CHAT );

        // Bedrock's Anthropic models take `system` separately from the user/assistant turns.
        const system : string | undefined =
            request.messages.filter( ( message ) => message.role === Ai.Role.SYSTEM ).map( ( message ) => message.content ).join( "\n" ) || undefined;
        const messages : Array<{ role : string; content : string }> =
            request.messages.filter( ( message ) => message.role !== Ai.Role.SYSTEM ).map( ( message ) => ( { role: message.role, content: message.content } ) );

        const requestBody : Record<string, unknown> = {
            anthropic_version : "bedrock-2023-05-31",
            max_tokens        : request.maxTokens ?? 1024,
            temperature       : request.temperature,
            system,
            messages,
            stop_sequences    : request.stop,
        };

        // The AWS SDK throws on failure; convert that into an Attempt so retry/return stay value-based.
        const outcome : Attempt<ClaudeBody> = await this.withRetry<ClaudeBody>( async () : Promise<Attempt<ClaudeBody>> =>
        {
            try
            {
                const invokeResult : InvokeModelCommandOutput = await this.client.send( new InvokeModelCommand( {
                    modelId     : this.model,
                    contentType : "application/json",
                    accept      : "application/json",
                    body        : new TextEncoder().encode( JSON.stringify( requestBody ) ),
                } ) );
                return { ok: true, value: JSON.parse( new TextDecoder().decode( invokeResult.body ) ) as ClaudeBody };
            }
            catch( error : unknown )
            {
                const status : number | undefined = ( error as { $metadata? : { httpStatusCode? : number } } ).$metadata?.httpStatusCode;
                return { ok: false, status, message: error instanceof Error ? error.message : "bedrock invoke failed" };
            }
        } );

        if( !outcome.ok )
            return { ok: false, error: { status: outcome.status, message: outcome.message }, text: "", usage: {}, model: this.model, provider: this.provider };

        const decoded : ClaudeBody = outcome.value;
        const usage : Ai.Usage = { inputTokens: decoded.usage?.input_tokens, outputTokens: decoded.usage?.output_tokens };
        this.emitUsage( usage, request.metadata );

        return {
            ok       : true,
            text     : decoded.content?.map( ( block ) => block.text ).join( "" ) ?? "",
            finish   : decoded.stop_reason,
            usage,
            model    : this.model,
            provider : this.provider,
        };
    }

    /** Generate image(s) with Titan Image Generator on Bedrock (TEXT_IMAGE), returned as base64. */
    override async image( request : Ai.ImageRequest ) : Promise<Ai.ImageResponse>
    {
        this.require( Ai.Capability.IMAGE );

        const [ width, height ] : [ number, number ] = BedrockAdapter.parseSize( request.size );
        const requestBody : Record<string, unknown> = {
            taskType            : "TEXT_IMAGE",
            textToImageParams   : { text: request.prompt },
            imageGenerationConfig : { numberOfImages: request.n ?? 1, width, height, cfgScale: 8 },
        };

        const outcome : Attempt<TitanImageBody> = await this.withRetry<TitanImageBody>( async () : Promise<Attempt<TitanImageBody>> =>
        {
            try
            {
                const invokeResult : InvokeModelCommandOutput = await this.client.send( new InvokeModelCommand( {
                    modelId     : BedrockAdapter.IMAGE_MODEL,
                    contentType : "application/json",
                    accept      : "application/json",
                    body        : new TextEncoder().encode( JSON.stringify( requestBody ) ),
                } ) );
                return { ok: true, value: JSON.parse( new TextDecoder().decode( invokeResult.body ) ) as TitanImageBody };
            }
            catch( error : unknown )
            {
                const status : number | undefined = ( error as { $metadata? : { httpStatusCode? : number } } ).$metadata?.httpStatusCode;
                return { ok: false, status, message: error instanceof Error ? error.message : "bedrock image invoke failed" };
            }
        } );

        if( !outcome.ok )
            return { ok: false, error: { status: outcome.status, message: outcome.message }, images: [], usage: {}, model: BedrockAdapter.IMAGE_MODEL, provider: this.provider };

        const images : Array<Ai.ImageOut> = ( outcome.value.images ?? [] ).map( ( b64 ) => ( { b64 } ) );
        const usage : Ai.Usage = { images: images.length };
        this.emitUsage( usage, request.metadata );
        return { ok: true, images, usage, model: BedrockAdapter.IMAGE_MODEL, provider: this.provider };
    }

    /** Parse a `"WxH"` size (default 1024×1024) into a Titan-supported width/height pair. */
    private static parseSize( size? : string ) : [ number, number ]
    {
        const match : RegExpMatchArray | null = ( size ?? "" ).match( /^(\d+)\s*x\s*(\d+)$/i );
        return match ? [ Number( match[ 1 ] ), Number( match[ 2 ] ) ] : [ 1024, 1024 ];
    }

    /**
     * Generate a video with Nova Reel. Bedrock video is ASYNC: start the invoke (output → the configured S3
     * bucket), poll to completion (minutes), then read the produced mp4 back from S3 and return its bytes.
     * Requires `videoBucket` (adapter option) — Nova Reel writes only to a caller S3 location.
     */
    override async video( request : Ai.VideoRequest ) : Promise<Ai.VideoResponse>
    {
        this.require( Ai.Capability.VIDEO );
        const errorResponse = ( message : string, status? : number ) : Ai.VideoResponse =>
            ( { ok: false, error: { status, message }, video: new Uint8Array(), mime: "video/mp4", usage: {}, model: BedrockAdapter.VIDEO_MODEL, provider: this.provider } );
        if( !this.videoBucket ) return errorResponse( "no video output bucket configured (videoBucket)" );

        try
        {
            // 1. start the async job — Nova Reel writes the mp4 under this S3 prefix (path-style so LocalStack works)
            const prefix : string = `ai-video/${ Date.now() }`;
            const started : StartAsyncInvokeCommandOutput = await this.client.send( new StartAsyncInvokeCommand( {
                modelId : BedrockAdapter.VIDEO_MODEL,
                modelInput : {
                    taskType : "TEXT_VIDEO",
                    textToVideoParams : { text: request.prompt },
                    videoGenerationConfig : { durationSeconds: request.durationSec ?? 6, fps: 24, dimension: "1280x720" },
                },
                outputDataConfig : { s3OutputDataConfig: { s3Uri: `s3://${ this.videoBucket }/${ prefix }` } },
            } ) );
            const invocationArn : string | undefined = started.invocationArn;
            if( !invocationArn ) return errorResponse( "no invocation arn returned" );

            // 2. poll the job until it completes / fails / times out
            const deadline : number = Date.now() + BedrockAdapter.VIDEO_TIMEOUT_MS;
            let status : string | undefined;
            while( Date.now() < deadline )
            {
                await BedrockAdapter.sleep( BedrockAdapter.VIDEO_POLL_MS );
                const got : GetAsyncInvokeCommandOutput = await this.client.send( new GetAsyncInvokeCommand( { invocationArn } ) );
                status = got.status;
                if( status === "Completed" || status === "Failed" ) break;
            }
            if( status !== "Completed" ) return errorResponse( `video job ${ status ?? "timed out" }` );

            // 3. read the produced mp4 back from S3 (Nova Reel names it output.mp4 under the prefix)
            const object : GetObjectCommandOutput = await this.s3.send( new GetObjectCommand( { Bucket: this.videoBucket, Key: `${ prefix }/output.mp4` } ) );
            if( !object.Body ) return errorResponse( "video output missing" );
            const video : Uint8Array = await ( object.Body as { transformToByteArray() : Promise<Uint8Array> } ).transformToByteArray();

            const usage : Ai.Usage = {};
            this.emitUsage( usage, request.metadata );
            return { ok: true, video, mime: "video/mp4", usage, model: BedrockAdapter.VIDEO_MODEL, provider: this.provider };
        }
        catch( error : unknown )
        {
            const status : number | undefined = ( error as { $metadata? : { httpStatusCode? : number } } ).$metadata?.httpStatusCode;
            return errorResponse( error instanceof Error ? error.message : "bedrock video failed", status );
        }
    }

    /** Sleep helper for the async-job poll loop. */
    private static sleep( ms : number ) : Promise<void> { return new Promise( ( resolve ) => setTimeout( resolve, ms ) ); }
}
