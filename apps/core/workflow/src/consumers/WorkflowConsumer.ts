//
import { Application, Consumer, Register, Dynamo, Kafka, Sqs } from "@repo/services";

//
// WorkflowConsumer — the domain base every concrete workflow ECS worker extends (mirrors
// WorkflowService on the HTTP side, and SearchConsumer's shape). `WorkflowTriggerConsumer` is a
// long-running `Consumer` (not a Lambda `Job`) for the SAME reason `SearchIndexerConsumer` is — the
// platform's `makeJob` trigger support is `"queue"` / `"table"` ONLY, there is no Lambda↔Kafka
// event-source-mapping — so a live Kafka firehose reader must be a `Consumer` (ECS), not a `Job`.
//
export abstract class WorkflowConsumer extends Consumer
{
    protected pkg : Application.PackageInfo;

    private _dynamo? : Dynamo;
    private _kafka?  : Kafka;
    private _sqs?    : Sqs;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( qualifier : string )
    {
        // identity = Register.Service.WORKFLOW (+ qualifier -> "workflow:trigger")
        super( Register.Service.WORKFLOW, qualifier );
        this.pkg = this.loadPackageInfo( __dirname );
        this.log.info( "version", { name: this.pkg.name, version: this.pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }
    public get kafka()  : Kafka  { return this._kafka  ??= new Kafka( this.cloud ); }
    public get sqs()    : Sqs    { return this._sqs    ??= new Sqs( this.cloud ); }
}

export default WorkflowConsumer;
// eof
