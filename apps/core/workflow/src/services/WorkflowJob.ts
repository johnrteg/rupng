//
import { Application, Job, Register, Dynamo, Kafka, Sqs, Scheduler } from "@repo/services";

//
// WorkflowJob — the domain base every concrete workflow Lambda Job extends (mirrors WorkflowService on
// the HTTP side, and MarketplaceJob's shape). Holds the facades the step-execution loop needs.
//
export abstract class WorkflowJob<TEvent = unknown, TResult = void> extends Job<TEvent, TResult>
{
    protected pkg : Application.PackageInfo;

    private _dynamo?    : Dynamo;
    private _kafka?     : Kafka;
    private _sqs?       : Sqs;
    private _scheduler? : Scheduler;

    ///////////////////////////////////////////////////////////////////////////////////////
    constructor( name : string )
    {
        super( Register.Service.WORKFLOW, name );
        this.pkg = this.loadPackageInfo( __dirname );
        this.log.info( "version", { name: this.pkg.name, version: this.pkg.version } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    protected get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }

    /** Kafka facade — lifecycle event emission (workflow.* topics), best-effort. Lazy + cached. */
    protected get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }

    /** SQS facade — re-enqueuing the next `workflow-advance` tick. Lazy + cached. */
    protected get sqs() : Sqs { return this._sqs ??= new Sqs( this.cloud ); }

    /** The dynamic EventBridge Scheduler facade — per-instance `sleep`/timeout wakeups. Lazy + cached. */
    protected get scheduler() : Scheduler { return this._scheduler ??= new Scheduler( this.cloud ); }
}

export default WorkflowJob;
