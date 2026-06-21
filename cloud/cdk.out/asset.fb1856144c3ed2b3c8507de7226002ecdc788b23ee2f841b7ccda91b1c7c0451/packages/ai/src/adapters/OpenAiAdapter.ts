//
// OpenAI adapter — chat + structured + image generation (DALL·E). HTTP goes through @repo/endpoint's
// RestfulService (the shared axios client) so every external call funnels through one place — never
// raw fetch. The api key is resolved lazily from the configured KeyProvider (KMS by default).
//
import { RestfulService } from "@repo/endpoint";

import { Ai } from "../AiModel";
import { BaseAdapter, AdapterOptions, Attempt } from "./BaseAdapter";

/** Internal shape of an OpenAI /v1/chat/completions response. */
interface ChatCompletion
{
    /** Reply choices (the first is used). */
    choices? : Array<{ message? : { content? : string }; finish_reason? : string }>;
    /** Token usage. */
    usage?   : { prompt_tokens? : number; completion_tokens? : number };
}

/** Internal shape of an OpenAI /v1/images/generations response. */
interface ImageGeneration
{
    /** Generated images (base64 and/or url). */
    data? : Array<{ b64_json? : string; url? : string }>;
}

/**
 * **OpenAI direct** adapter — chat, structured, and image generation (DALL·E) over
 * {@link RestfulService}. The api key is resolved lazily from the configured {@link KeyProvider}
 * (KMS by default).
 */
export class OpenAiAdapter extends BaseAdapter
{
    /** @inheritDoc */
    readonly provider     : Ai.Provider = Ai.Provider.OPENAI;
    /** Chat + structured + image. */
    readonly capabilities : ReadonlySet<Ai.Capability> =
        new Set<Ai.Capability>( [ Ai.Capability.CHAT, Ai.Capability.STRUCTURED, Ai.Capability.IMAGE ] );

    /** API origin (RestfulService base url). */
    private static readonly BASE_URL    : string = "https://api.openai.com";
    /** Chat completions path. */
    private static readonly CHAT_PATH   : string = "/v1/chat/completions";
    /** Image generation path. */
    private static readonly IMAGE_PATH  : string = "/v1/images/generations";
    /** Image model used by {@link OpenAiAdapter.image} (independent of the chat `model`). */
    private static readonly IMAGE_MODEL : string = "dall-e-3";

    /** Shared HTTP client for all calls to the OpenAI API. */
    private readonly http : RestfulService;

    /** @param opts adapter options; `model` defaults to `gpt-4o-mini`. */
    constructor( opts : AdapterOptions = {} )
    {
        super( opts, "gpt-4o-mini" );
        this.http = new RestfulService( OpenAiAdapter.BASE_URL );
    }

    /** Post the conversation to chat/completions and return the first choice's text. */
    override async chat( request : Ai.ChatRequest ) : Promise<Ai.ChatResponse>
    {
        this.require( Ai.Capability.CHAT );
        const key : string = await this.key();

        const outcome : Attempt<ChatCompletion> = await this.withRetry<ChatCompletion>( async () : Promise<Attempt<ChatCompletion>> =>
        {
            const response : RestfulService.Reply = await this.http.post(
                OpenAiAdapter.CHAT_PATH,
                null,
                {
                    model       : this.model,
                    messages    : request.messages.map( ( message ) => ( { role: message.role, content: message.content } ) ),
                    max_tokens  : request.maxTokens,
                    temperature : request.temperature,
                    stop        : request.stop,
                },
                { authorization: `Bearer ${key}` },
            );
            return response.ok
                ? { ok: true, value: response.data as ChatCompletion }
                : { ok: false, status: response.status, message: RestfulService.error( response, "openai request failed" ) };
        } );

        if( !outcome.ok )
            return { ok: false, error: { status: outcome.status, message: outcome.message }, text: "", usage: {}, model: this.model, provider: this.provider };

        const completion : ChatCompletion = outcome.value;
        const choice : { message? : { content? : string }; finish_reason? : string } | undefined = completion.choices?.[ 0 ];
        const usage : Ai.Usage = { inputTokens: completion.usage?.prompt_tokens, outputTokens: completion.usage?.completion_tokens };
        this.emitUsage( usage, request.metadata );

        return {
            ok       : true,
            text     : choice?.message?.content ?? "",
            finish   : choice?.finish_reason,
            usage,
            model    : this.model,
            provider : this.provider,
        };
    }

    /** Generate image(s) with DALL·E, returned as base64 payloads. */
    override async image( request : Ai.ImageRequest ) : Promise<Ai.ImageResponse>
    {
        this.require( Ai.Capability.IMAGE );
        const key : string = await this.key();

        const outcome : Attempt<ImageGeneration> = await this.withRetry<ImageGeneration>( async () : Promise<Attempt<ImageGeneration>> =>
        {
            const response : RestfulService.Reply = await this.http.post(
                OpenAiAdapter.IMAGE_PATH,
                null,
                {
                    model           : OpenAiAdapter.IMAGE_MODEL,
                    prompt          : request.prompt,
                    n               : request.n ?? 1,
                    size            : request.size ?? "1024x1024",
                    response_format : "b64_json",
                },
                { authorization: `Bearer ${key}` },
            );
            return response.ok
                ? { ok: true, value: response.data as ImageGeneration }
                : { ok: false, status: response.status, message: RestfulService.error( response, "openai request failed" ) };
        } );

        if( !outcome.ok )
            return { ok: false, error: { status: outcome.status, message: outcome.message }, images: [], usage: {}, model: OpenAiAdapter.IMAGE_MODEL, provider: this.provider };

        const generation : ImageGeneration = outcome.value;
        const images : Array<Ai.ImageOut> = ( generation.data ?? [] ).map( ( item ) => ( { b64: item.b64_json, url: item.url } ) );
        const usage : Ai.Usage = { images: images.length };
        this.emitUsage( usage, request.metadata );

        return { ok: true, images, usage, model: OpenAiAdapter.IMAGE_MODEL, provider: this.provider };
    }
}
