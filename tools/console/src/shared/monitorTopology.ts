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
        publishes:  [ "auth.user", "auth.session", "auth.passkey", "auth.apikey" ],
        subscribes: [ { topic: "media.asset", group: "auth-avatar" } ],
    },
    {
        id:         "account",
        publishes:  [ "account.account", "account.member", "account.invite" ],
        subscribes: [
            { topic: "auth.user",    group: "account-provisioning" },
            { topic: "auth.session", group: "account-lastlogin" },
            { topic: "media.asset",  group: "account-avatar" },
        ],
    },
    {
        id:         "app",
        publishes:  [],
        subscribes: [
            { topic: "account.account", group: "app-readmodel" },
            { topic: "auth.user",       group: "app-readmodel" },
        ],
    },
    {
        id:         "email",
        publishes:  [ "email.template" ],
        subscribes: [
            { topic: "auth.user",      group: "email-transactional" },
            { topic: "account.member", group: "email-transactional" },
        ],
    },
    {
        id:         "media",
        publishes:  [ "media.asset", "media.job" ],
        subscribes: [],
    },
    // Kafka facade is wired for these two (kafka getter on their Service base) but there is no
    // publishEvent/subscribeEvents call site yet — listed so the ring still shows the node (idle, no pipes)
    // rather than omitting the service entirely; fill in publishes/subscribes the day its first call site lands.
    {
        id:         "contact",
        publishes:  [],
        subscribes: [],
    },
    {
        id:         "campaign",
        publishes:  [],
        subscribes: [],
    },
    // Every other catalog service (registration, workflow, marketplace, texting, voice, print, social,
    // survey, links, analytics, report, monitor, audit, search, realtime, collab, fake-email, web) is
    // either spec-only (no CloudManifest/MainService yet) or explicitly Kafka-free (fake-email, web) — so it
    // has nothing to add here yet. Add its entry the same day its first `kafka.publishEvent`/
    // `kafka.subscribeEvents` call site lands.
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
