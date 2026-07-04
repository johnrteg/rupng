//
import { Application, Job, Register, Dynamo, S3, Sqs } from "@repo/services";
import { Ai } from "@repo/ai";
import { MediaConfig, AiRouting } from "@repo/api";

import { MediaPipeline } from "../pipeline/MediaPipeline";

//
// common media job base — the domain base every concrete media Job extends (mirrors MediaService on the
// HTTP side). Holds the facades + the shared MediaPipeline deps, so scan/process run the SAME code whether
// drained locally by MediaMainService or executed as a Lambda here. Concrete jobs extend THIS.
//
export abstract class MediaJob<TEvent = unknown, TResult = void> extends Job<TEvent, TResult>
{
    protected pkg : Application.PackageInfo;

    private _dynamo? : Dynamo;
    private _s3?     : S3;
    private _sqs?    : Sqs;

    ///////////////////////////////////////////////////////////////////////////////////////
    constructor( name : string )
    {
        super( Register.Service.MEDIA, name );
        this.pkg = this.loadPackageInfo( __dirname );
        this.log.info( "version", { name: this.pkg.name, version: this.pkg.version } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    protected get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }
    protected get s3()     : S3     { return this._s3     ??= new S3( this.cloud ); }
    protected get sqs()    : Sqs    { return this._sqs    ??= new Sqs( this.cloud ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** The live runtime config (AppConfig config/settings), falling back to the seeded defaults. */
    protected async mediaConfig() : Promise<MediaConfig.Config>
    {
        const got : { ok : boolean; data? : MediaConfig.Config } = await this.appConfig.json<MediaConfig.Config>( "config", "settings" );
        return got.ok && got.data ? got.data : MediaConfig.DEFAULT;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** The facades + live config the shared MediaPipeline needs. Async so it can resolve live config. */
    protected async pipelineDeps() : Promise<MediaPipeline.Deps>
    {
        const config : MediaConfig.Config = await this.mediaConfig();
        // Resolve the CHAT-modality client (auto-tag vision) from config/ai routing — only when auto-tag is on.
        const chatAi : Ai | undefined = config.autoTag.enabled ? await this.aiFor( AiRouting.Modality.CHAT ) : undefined;
        return { dynamo: this.dynamo, s3: this.s3, sqs: this.sqs, log: this.log, config, chatAi };
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Parse the `{ accountId, guid, profile?, rescan?, posterAt? }` refs out of an SQS Lambda event's records.
     *  `profile` = on-demand variant generation (media-4.6); `rescan` = metadata re-probe; `posterAt` = video
     *  poster regeneration at a frame; all absent for the initial scan/process pass. */
    protected mediaRefs( event : unknown ) : Array<{ accountId : string; guid : string; profile? : string; rescan? : boolean; posterAt? : number }>
    {
        const records : Array<{ body? : string }> = ( event as { Records? : Array<{ body? : string }> } )?.Records ?? [];
        const refs : Array<{ accountId : string; guid : string; profile? : string; rescan? : boolean; posterAt? : number }> = [];
        for( const record of records )
        {
            try
            {
                const parsed : any = JSON.parse( record.body ?? "{}" ) as { accountId? : string; guid? : string; profile? : string; rescan? : boolean; posterAt? : number };
                if( parsed.accountId && parsed.guid ) refs.push( { accountId: parsed.accountId, guid: parsed.guid, profile: parsed.profile, rescan: parsed.rescan, posterAt: parsed.posterAt } );
            }
            catch { /* skip a malformed record */ }
        }
        return refs;
    }
}

export default MediaJob;
