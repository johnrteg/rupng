//
import { Application, Daemon, Trace, Register } from "@repo/services";

import WorkflowMainService from "./services/WorkflowMainService";
import WorkflowTriggerConsumer from "./consumers/WorkflowTriggerConsumer";

//
// role from the environment — `main` is the HTTP authoring/instance API (WorkflowMainService); `trigger`
// is the ECS Consumer matching the Kafka event stream against account trigger bindings to start/signal
// instances (WorkflowTriggerConsumer). The step/scheduler Jobs are separate Lambda entrypoints (see
// jobs/WorkflowStepJob.ts / jobs/WorkflowSchedulerJob.ts), not part of this factory.
//
const role : string = process.env.SERVICE_ROLE ?? "main";

const services : Record<string, () => Daemon> =
{
    "main"    : () => new WorkflowMainService(),
    "trigger" : () => new WorkflowTriggerConsumer(),
};

const factory : ( () => Daemon ) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.WORKFLOW, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}

// eof
