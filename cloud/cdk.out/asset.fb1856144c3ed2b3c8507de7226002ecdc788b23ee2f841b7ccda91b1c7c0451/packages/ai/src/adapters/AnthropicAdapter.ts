//
// Anthropic adapter — Claude via the direct Messages API (api key). HTTP goes through @repo/endpoint's
// RestfulService (the shared axios client) so every external call funnels through one place — never
// raw fetch. The api key is resolved lazily from the configured KeyProvider (KMS by default).
//
import { RestfulService } from "@repo/endpoint";

import { Ai } from "../AiModel";
import { BaseAdapter, AdapterOptions, Attempt } from "./BaseAdapter";

/** Internal shape of an Anthropic /v1/messages response. */
interface MessagesResponse
{
    /** Reply content blocks (text parts are concatenated). */
    content?     : Array<{ type : string; text : string }>;
    /** Provider stop reason. */
    stop_reason? : string;
    /** Token usage. */
    usage?       : { input_tokens? : number; output_tokens? : number };
}

/**
 * **Anthropic direct** adapter — Claude via the Messages API over {@link RestfulService}.
 * The API key is resolved lazily from the configured {@link KeyProvider} (KMS by default).
 * Supports {@link Ai.Capability.CHAT} and {@link Ai.Capability.STRUCTURED}.
 */
export class AnthropicAdapter extends BaseAdapter
{
    /** @inheritDoc */
    readonly provider     : Ai.Provider = Ai.Provider.ANTHROPIC;
    /** Chat + structured. */
    readonly capabilities : ReadonlySet<Ai.Capability> = new Set<Ai.Capability>( [ Ai.Capability.CHAT, Ai.Capability.STRUCTURED ] );

    /** API origin (RestfulService base url). */
    private static readonly BASE_URL : string = "https://api.anthropic.com";
    /** The Messages API path. */
    private static readonly PATH     : string = "/v1/messages";
    /** The pinned Anthropic API version header. */
    private static readonly VERSION  : string = "2023-06-01";

    /** Shared HTTP client for all calls to the Anthropic API. */
    private readonly http : RestfulService;

    /** @param opts adapter options; `model` defaults to the latest Claude 3.5 Sonnet. */
    constructor( opts : AdapterOptions = {} )
    {
        super( opts, "claude-3-5-sonnet-latest" );
        this.http = new RestfulService( AnthropicAdapter.BASE_URL );
    }

    /**
     * Post the conversation to the Messages API and return the text reply. System turns are sent in
     * the separate `system` field; the api key is fetched once via the {@link KeyProvider}.
     */
    override async chat( request : Ai.ChatRequest ) : Promise<Ai.ChatResponse>
    {
        this.require( Ai.Capability.CHAT );
        const key : string = await this.key();

        const system : string | undefined =
            request.messages.filter( ( message ) => message.role === Ai.Role.SYSTEM ).map( ( message ) => message.content ).join( "\n" ) || undefined;
        const messages : Array<{ role : string; content : string }> =
            request.messages.filter( ( message ) => message.role !== Ai.Role.SYSTEM ).map( ( message ) => ( { role: message.role, content: message.content } ) );

        const outcome : Attempt<MessagesResponse> = await this.withRetry<MessagesResponse>( async () : Promise<Attempt<MessagesResponse>> =>
        {
            const response : RestfulService.Reply = await this.http.post(
                AnthropicAdapter.PATH,
                null,
                {
                    model          : this.model,
                    max_tokens     : request.maxTokens ?? 1024,
                    temperature    : request.temperature,
                    system,
                    messages,
                    stop_sequences : request.stop,
                },
                { "x-api-key": key, "anthropic-version": AnthropicAdapter.VERSION },
            );
            // RestfulService returns ok:false instead of throwing — carry the status forward so
            // withRetry can decide whether it's transient.
            return response.ok
                ? { ok: true, value: response.data as MessagesResponse }
                : { ok: false, status: response.status, message: RestfulService.error( response, "anthropic request failed" ) };
        } );

        if( !outcome.ok )
            return { ok: false, error: { status: outcome.status, message: outcome.message }, text: "", usage: {}, model: this.model, provider: this.provider };

        const payload : MessagesResponse = outcome.value;
        const usage : Ai.Usage = { inputTokens: payload.usage?.input_tokens, outputTokens: payload.usage?.output_tokens };
        this.emitUsage( usage, request.metadata );

        return {
            ok       : true,
            text     : payload.content?.map( ( block ) => block.text ).join( "" ) ?? "",
            finish   : payload.stop_reason,
            usage,
            model    : this.model,
            provider : this.provider,
        };
    }
}
