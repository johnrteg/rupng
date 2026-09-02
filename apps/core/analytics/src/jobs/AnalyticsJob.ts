//
import { Application, Job, Register, Dynamo, S3 } from "@repo/services";

//
// AnalyticsJob — the domain base every concrete analytics Lambda job extends (mirrors
// AnalyticsService/AnalyticsConsumer). Holds the shared domain wiring (Dynamo + S3) for the
// operator-triggered, one-shot jobs (AnalyticsBackfillJob today; AnalyticsScheduleJob/
// AnalyticsAttributionJob/AnalyticsForgetJob land later — see SPECS.md "Service & Job topology").
// Distinct from `AnalyticsConsumer`: THOSE are long-running Kafka firehose readers; these are
// invoke-work-exit Lambdas triggered by a queue/schedule/operator action.
//
export abstract class AnalyticsJob<TEvent = unknown, TResult = void> extends Job<TEvent, TResult>
{
    protected pkg : Application.PackageInfo;

    private _dynamo? : Dynamo;
    private _s3?     : S3;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( name : string )
    {
        super( Register.Service.ANALYTICS, name );
        this.pkg = this.loadPackageInfo( __dirname );
        this.log.info( "version", { name: this.pkg.name, version: this.pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }
    public get s3() : S3 { return this._s3 ??= new S3( this.cloud ); }
}

export default AnalyticsJob;
// eof
