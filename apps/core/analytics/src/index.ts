//
import { Application, Daemon, Trace, Register } from "@repo/services";

import AnalyticsQueryService from "./services/AnalyticsQueryService";
import AnalyticsIngestConsumer from "./consumers/AnalyticsIngestConsumer";
import AnalyticsRollupConsumer from "./consumers/AnalyticsRollupConsumer";

//
// role from the environment — `main` is the HTTP Query API (AnalyticsQueryService); `ingest` and
// `rollup` are ECS workers consuming the analytics Kafka streams (own consumer groups) into the raw
// lake / the rollups table, respectively. See SPECS.md "Service & Job topology" + the gap register
// for what's still deferred (Athena/Glue, attribution, …).
//
const role : string = process.env.SERVICE_ROLE ?? "main";

const services : Record<string, () => Daemon> =
{
    "main"   : () => new AnalyticsQueryService(),
    "ingest" : () => new AnalyticsIngestConsumer(),
    "rollup" : () => new AnalyticsRollupConsumer(),
};

const factory : ( () => Daemon ) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.ANALYTICS, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}

// eof
