//
// Consumer — the self-driven Daemon: a long-running process that pulls its own work off the
// Kafka / SQS / stream backbone in a run-loop (the "consumes" role). Reach for it when a
// per-event Lambda `Job` is the wrong shape — a high-volume firehose filtered to a subset, or
// holding a live connection — where you want consumer-group offset control + self-paced
// backpressure (e.g. the realtime ingest consumer + outbox drainer). The long-running lifecycle
// (OS signals, graceful drain, fatal-boot, process.exit) lives on `Daemon`; Consumer adds only
// the consume-loop scaffold.
//
// Contrast `Job`: a Job is one-shot (invoke → work → exit); a Consumer runs continuously.
//

import { Daemon } from './Daemon';
import type { Events } from '@repo/events';

export abstract class Consumer extends Daemon
{
    ////////////////////////////////////////////////////////////////////////
    constructor( service : Events.Service, qualifier ? : string )
    {
        super( service, qualifier );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // start() is the Application lifecycle's final boot step. For a Consumer it enters the consume loop,
    // which BLOCKS (keeps the process alive) until a shutdown signal stops it (isShuttingDown()).
    protected async start() : Promise<void>
    {
        await super.start();
        this.log.info("Consumer starting - entering consume loop");
        await this.consume();
        this.log.info("Consumer consume loop exited");
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // The consume / drain loop — implemented by the concrete consumer:
    //   • a Kafka consumer-group subscription (the facade drives message delivery), or
    //   • an SQS poll loop, or
    //   • a leased per-connection drain loop (e.g. the realtime outbox drainer).
    // It SHOULD honor isShuttingDown() — stop pulling new work and let in-flight finish — so the
    // Daemon's graceful drain (aboutToQuit → exit) completes cleanly within the shutdown timeout.
    protected abstract consume() : Promise<void>;

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // on shutdown the Daemon flips isShuttingDown() (the consume loop should observe it + drain); override
    // to release leases / commit offsets / close the consumer group, then call super.aboutToQuit().
    protected async aboutToQuit() : Promise<void>
    {
        await super.aboutToQuit();
    }
}

export default Consumer;
