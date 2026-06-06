//
// Bedrock adapter — the default. IAM-authed (no API key), Claude on Bedrock via InvokeModel.
// Body/response use the Anthropic Messages format that Bedrock's anthropic.* models expect.
//
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import type { InvokeModelCommandOutput } from "@aws-sdk/client-bedrock-runtime";

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

/**
 * The default adapter: **AWS Bedrock**, IAM-authed (no API key), invoking Claude via `InvokeModel`.
 * Request/response use the Anthropic Messages format Bedrock's `anthropic.*` models expect.
 * Supports {@link Ai.Capability.CHAT} and {@link Ai.Capability.STRUCTURED} (the latter via the base).
 */
export class BedrockAdapter extends BaseAdapter
{
    /** @inheritDoc */
    readonly provider     : Ai.Provider = Ai.Provider.BEDROCK;
    /** Chat + structured (no key needed — Bedrock uses IAM). */
    readonly capabilities : ReadonlySet<Ai.Capability> = new Set<Ai.Capability>( [ Ai.Capability.CHAT, Ai.Capability.STRUCTURED ] );

    /** The Bedrock runtime client (IAM-authed via the ambient AWS credentials). */
    private readonly client : BedrockRuntimeClient;

    /** @param opts adapter options; `model` defaults to Claude 3.5 Sonnet on Bedrock. */
    constructor( opts : AdapterOptions = {} )
    {
        super( opts, "anthropic.claude-3-5-sonnet-20240620-v1:0" );
        this.client = new BedrockRuntimeClient( { region: opts.region ?? process.env.AWS_REGION ?? "us-east-1" } );
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
}
