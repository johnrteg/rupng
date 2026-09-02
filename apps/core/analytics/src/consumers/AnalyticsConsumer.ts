//
import { Application, Consumer, Register, Dynamo, S3, Kafka } from "@repo/services";

//
// AnalyticsConsumer — the domain base every concrete analytics ECS worker extends (mirrors
// AnalyticsService on the HTTP side). `AnalyticsIngestConsumer` / `AnalyticsRollupConsumer` are
// long-running `Consumer`s (not Lambda `Job`s) per the platform's existing convention for a
// high-volume Kafka firehose — see apps/core/analytics/SPECS.md "Service & Job topology" (updated
// to match; the ORIGINAL spec described these as Lambda Jobs, but the platform has no Lambda↔MSK
// event-source-mapping anywhere, and `Consumer`'s own doc comment names this exact shape —
// "the realtime ingest consumer" — as its intended use case).
//
export abstract class AnalyticsConsumer extends Consumer
{
    protected pkg : Application.PackageInfo;

    private _dynamo? : Dynamo;
    private _s3?     : S3;
    private _kafka?  : Kafka;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( qualifier : string )
    {
        // identity = Register.Service.ANALYTICS (+ qualifier → "analytics:ingest" / "analytics:rollup")
        super( Register.Service.ANALYTICS, qualifier );
        this.pkg = this.loadPackageInfo( __dirname );
        this.log.info( "version", { name: this.pkg.name, version: this.pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }
    public get s3() : S3 { return this._s3 ??= new S3( this.cloud ); }
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }
}

export default AnalyticsConsumer;
// eof
