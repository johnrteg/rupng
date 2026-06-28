import type { MonitorTopology, MonitorService } from "./types";

//
// Kafka topology — the service↔topic graph the Monitor draws (services on a ring, each pipe radiating
// to the central Kafka hub). This MIRRORS the per-service CloudManifest `publishes`/`subscribes`
// declarations; it lives here (rather than being imported from the apps) because the console isn't a
// dependency of the services. Keep it in sync with the manifests — or generate it from them later.
//
const SERVICES : MonitorService[] =
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
function allTopics( services : MonitorService[] ) : string[]
{
    const set : Set<string> = new Set<string>();
    for ( const svc of services )
    {
        for ( const t of svc.publishes ) set.add( t );
        for ( const s of svc.subscribes ) set.add( s.topic );
    }
    return [ ...set ].sort();
}

export const TOPOLOGY : MonitorTopology = { services: SERVICES, topics: allTopics( SERVICES ) };

/** The service that publishes a topic (or undefined — e.g. a topic whose producer service isn't present). */
export function publisherOf( topic : string ) : string | undefined
{
    return SERVICES.find( ( s ) => s.publishes.includes( topic ) )?.id;
}

/** The consumer groups subscribed to a topic (across all services). */
export function subscriberGroupsOf( topic : string ) : string[]
{
    const groups : string[] = [];
    for ( const svc of SERVICES )
        for ( const s of svc.subscribes )
            if ( s.topic === topic && s.group && !groups.includes( s.group ) ) groups.push( s.group );
    return groups;
}

/** The services subscribed to a topic (for drawing hub→subscriber pipes). */
export function subscriberServicesOf( topic : string ) : string[]
{
    return SERVICES.filter( ( s ) => s.subscribes.some( ( b ) => b.topic === topic ) ).map( ( s ) => s.id );
}
