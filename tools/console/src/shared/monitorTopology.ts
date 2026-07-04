import type { MonitorTopology, MonitorService } from "./types";

//
// Kafka topology — the service↔topic graph the Monitor draws (services on a ring, each pipe radiating
// to the central Kafka hub). This MIRRORS the per-service CloudManifest `publishes`/`subscribes`
// declarations; it lives here (rather than being imported from the apps) because the console isn't a
// dependency of the services. Keep it in sync with the manifests — or generate it from them later.
//
const SERVICES : Array<MonitorService> =
[
    {
        id:         "auth",
        publishes:  [ "auth.user" ],
        subscribes: [],
    },
    {
        id:         "account",
        publishes:  [ "account.account" ],
        subscribes: [ { topic: "auth.user", group: "account-provisioning" } ],
    },
    {
        id:         "app",
        publishes:  [ "platform.behavior" ],
        subscribes: [
            { topic: "media.asset",     group: "app-cache-invalidation" },
            { topic: "account.account", group: "app-readmodel" },
            { topic: "auth.user",       group: "app-readmodel" },
        ],
    },
];

/** All distinct topics across every binding — what the monitor consumer subscribes to. */
function allTopics( services : Array<MonitorService> ) : Array<string>
{
    // Collect both published and subscribed topics into a set so each distinct topic appears once.
    const topics : Set<string> = new Set<string>();
    for ( const service of services )
    {
        for ( const topic of service.publishes ) topics.add( topic );
        for ( const binding of service.subscribes ) topics.add( binding.topic );
    }
    return [ ...topics ].sort();
}

export const TOPOLOGY : MonitorTopology = { services: SERVICES, topics: allTopics( SERVICES ) };

/** The service that publishes a topic (or undefined — e.g. a topic whose producer service isn't present). */
export function publisherOf( topic : string ) : string | undefined
{
    return SERVICES.find( ( service ) => service.publishes.includes( topic ) )?.id;
}

/** The consumer groups subscribed to a topic (across all services). */
export function subscriberGroupsOf( topic : string ) : Array<string>
{
    const groups : Array<string> = [];
    for ( const service of SERVICES )
        for ( const binding of service.subscribes )
            if ( binding.topic === topic && binding.group && !groups.includes( binding.group ) ) groups.push( binding.group );
    return groups;
}

/** The services subscribed to a topic (for drawing hub→subscriber pipes). */
export function subscriberServicesOf( topic : string ) : Array<string>
{
    return SERVICES.filter( ( service ) => service.subscribes.some( ( binding ) => binding.topic === topic ) ).map( ( service ) => service.id );
}
