//
import { Application, Daemon, Trace, Register } from "@repo/services";

import SearchQueryService from "./services/SearchQueryService";
import SearchIndexerConsumer from "./consumers/SearchIndexerConsumer";

//
// role from the environment — `main` is the HTTP query API (SearchQueryService); `indexer` is the
// ECS worker consuming the platform's entity-change streams (own consumer group) into OpenSearch.
// See SPECS.md "Service & Job topology" for what's deferred (SearchReindexJob's real rebuild path,
// index-mapping/analyzer creation).
//
const role : string = process.env.SERVICE_ROLE ?? "main";

const services : Record<string, () => Daemon> =
{
    "main"    : () => new SearchQueryService(),
    "indexer" : () => new SearchIndexerConsumer(),
};

const factory : ( () => Daemon ) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.SEARCH, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}

// eof
