//
// Magnific / Freepik adapter — image generation (media-17). Freepik's image APIs are ASYNC (create a task →
// poll → the result is a URL), so image() starts the task, polls to completion, and returns the image URL(s).
// The api key is resolved lazily from the configured KeyProvider (platform Secrets: `ai-magnific`).
//
// NOTE: built best-effort against Freepik's documented "Mystic" text-to-image shape; the exact request/response
// fields should be verified against the live API once a key is available (endpoint paths + field names may
// need tuning). Isolated here so only this adapter changes.
//
import { Ai } from "../AiModel";
import { BaseAdapter, AdapterOptions, Attempt } from "./BaseAdapter";

/** Internal shape of a Freepik create-task / poll response (task id, then the generated image URLs). */
interface FreepikTask { data? : { task_id? : string; status? : string; generated? : Array<string> }; }

/**
 * **Magnific / Freepik** adapter — text-to-image over Freepik's async task API. Returns image URL(s); the
 * caller fetches the bytes. The api key is resolved lazily from the configured KeyProvider.
 */
export class MagnificAdapter extends BaseAdapter
{
    /** @inheritDoc */
    readonly provider     : Ai.Provider = Ai.Provider.MAGNIFIC;
    /** Image generation. */
    readonly capabilities : ReadonlySet<Ai.Capability> = new Set<Ai.Capability>( [ Ai.Capability.IMAGE ] );

    private static readonly BASE_URL    : string = "https://api.freepik.com";
    private static readonly CREATE_PATH : string = "/v1/ai/mystic";
    private static readonly TIMEOUT_MS  : number = 3 * 60 * 1000;
    private static readonly POLL_MS     : number = 4 * 1000;

    /** @param opts adapter options; `model` defaults to `mystic`. */
    constructor( opts : AdapterOptions = {} )
    {
        super( opts, "mystic" );
    }

    /** Generate image(s): create the async task, poll to completion, return the produced URL(s). */
    override async image( request : Ai.ImageRequest ) : Promise<Ai.ImageResponse>
    {
        this.require( Ai.Capability.IMAGE );
        const key : string = await this.key();
        const fail = ( message : string, status? : number ) : Ai.ImageResponse =>
            ( { ok: false, error: { status, message }, images: [], usage: {}, model: this.model, provider: this.provider } );

        const outcome : Attempt<Array<string>> = await this.withRetry<Array<string>>( async () : Promise<Attempt<Array<string>>> =>
        {
            try
            {
                // 1. create the generation task
                const create : Response = await fetch( `${ MagnificAdapter.BASE_URL }${ MagnificAdapter.CREATE_PATH }`, {
                    method  : "POST",
                    headers : { "x-freepik-api-key": key, "Content-Type": "application/json" },
                    body    : JSON.stringify( { prompt: request.prompt, num_images: request.n ?? 1 } ),
                } );
                if( !create.ok ) return { ok: false, status: create.status, message: `freepik create failed: ${ create.status }` };
                const taskId : string | undefined = ( await create.json() as FreepikTask ).data?.task_id;
                if( !taskId ) return { ok: false, message: "freepik: no task id" };

                // 2. poll the task until it completes (or times out)
                const deadline : number = Date.now() + MagnificAdapter.TIMEOUT_MS;
                while( Date.now() < deadline )
                {
                    await MagnificAdapter.sleep( MagnificAdapter.POLL_MS );
                    const poll : Response = await fetch( `${ MagnificAdapter.BASE_URL }${ MagnificAdapter.CREATE_PATH }/${ taskId }`, {
                        headers : { "x-freepik-api-key": key },
                    } );
                    if( !poll.ok ) continue;
                    const task : FreepikTask = await poll.json() as FreepikTask;
                    if( task.data?.status === "COMPLETED" ) return { ok: true, value: task.data.generated ?? [] };
                    if( task.data?.status === "FAILED" )    return { ok: false, message: "freepik task failed" };
                }
                return { ok: false, message: "freepik task timed out" };
            }
            catch( error : unknown ) { return { ok: false, message: `freepik error: ${ String( error ) }` }; }
        } );

        if( !outcome.ok ) return fail( outcome.message, outcome.status );
        const images : Array<Ai.ImageOut> = outcome.value.map( ( url ) => ( { url } ) );
        const usage : Ai.Usage = { images: images.length };
        this.emitUsage( usage, request.metadata );
        return { ok: true, images, usage, model: this.model, provider: this.provider };
    }

    /** Sleep helper for the async-task poll loop. */
    private static sleep( ms : number ) : Promise<void> { return new Promise( ( resolve ) => setTimeout( resolve, ms ) ); }
}

export default MagnificAdapter;
