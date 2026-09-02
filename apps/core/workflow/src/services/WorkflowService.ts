//
import { Application, Service, Ports, Register, Dynamo, Kafka, Sqs, Scheduler } from "@repo/services";
import { Events } from "@repo/system";
import { emitWorkflowEvent } from "../engine/emitWorkflowEvent";

//
// WorkflowService — the workflow domain's Service BASE (not deployed alone). Holds the shared domain
// wiring (DynamoDB + Kafka + SQS + the dynamic Scheduler facade) so the concrete HTTP role
// (WorkflowMainService) inherits it. `WorkflowConsumer` (the trigger role) and `WorkflowJob` (the step/
// scheduler Lambdas) are SEPARATE domain bases — Service/Consumer/Job are different platform base
// classes — sharing this table/queue access via `../store/WorkflowStore`'s plain functions rather than
// inheritance (mirrors search's Service/Consumer split).
//
export class WorkflowService extends Service
{
    private _dynamo?    : Dynamo;
    private _kafka?     : Kafka;
    private _sqs?       : Sqs;
    private _scheduler?  : Scheduler;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( role : WorkflowService.Role )
    {
        // super( serviceId, role, defaultLocalPort ) — env PORT overrides the default when set.
        super( Register.Service.WORKFLOW, role, WorkflowService.PORT[ role ] );

        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** DynamoDB facade — definitions + instances. Lazy + cached. */
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }

    /** Kafka facade — CRUD/lifecycle event emission (workflow.* topics), best-effort. Lazy + cached. */
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }

    /** SQS facade — the `workflow-advance` step-execution loop. Lazy + cached. */
    public get sqs() : Sqs { return this._sqs ??= new Sqs( this.cloud ); }

    /** The dynamic EventBridge Scheduler facade — per-instance `sleep`/timeout wakeups. Lazy + cached. */
    public get scheduler() : Scheduler { return this._scheduler ??= new Scheduler( this.cloud ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Publish a `workflow.workflow.*` or `workflow.instance.*` lifecycle event. Best-effort — a bus
     *  miss is logged, never fails the caller. */
    public async emit( object : Events.Object.WORKFLOW_WORKFLOW | Events.Object.WORKFLOW_INSTANCE, verb : Events.Verb, targetId : string, accountId : string, data : unknown, actorUserId? : string ) : Promise<void>
    {
        await emitWorkflowEvent( this.kafka, this.log, object, verb, targetId, accountId, data, actorUserId );
    }
}

export namespace WorkflowService
{
    /** `WorkflowService` (this base) is only ever run as `main` — the `/workflow/* ` API. The `trigger`
     *  role is a `WorkflowConsumer` (`extends Consumer`, a different platform base entirely, see
     *  `../consumers/WorkflowTriggerConsumer.ts`) and never constructs a `WorkflowService`. */
    export enum Role { MAIN = "main" }

    /** Default local port per role (also the manifest containerPort — one source, can't drift). */
    export const PORT : Record<Role, number> = { [ Role.MAIN ]: Ports.WORKFLOW.MAIN };
}

export default WorkflowService;
