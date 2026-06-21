import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { CATALOG, CATALOG_ORDER, type CatalogEntry } from "../shared/catalog";
import type { ServiceInfo, ServiceRole } from "../shared/types";
import { APPS_CORE, REPO_ROOT, serviceDir } from "./paths";
import { servicePorts } from "./ports";

//
// Service discovery. The catalog says what *could* exist; the filesystem says what *does* and what
// it can do right now. We scan apps/core/*, merge with the catalog, and compute live capabilities —
// so the fleet "expands as services come online" with no edits here: a new apps/core/<x> appears
// automatically, and a scaffolded one flips from "planned" to actionable the moment it has the files.
//

const EXCLUDE = new Set( [ "webproxy" ] ); // local-only dev proxy — never built/deployed by the console

const hasRootDockerfile = existsSync( join( REPO_ROOT, "Dockerfile" ) );

function readPkg( dir : string ) : { scripts?: Record<string, string>; version?: string } | undefined
{
    const p : string = join( dir, "package.json" );
    if ( !existsSync( p ) ) return undefined;
    try { return JSON.parse( readFileSync( p, "utf8" ) ); }
    catch { return undefined; }
}

function rolesFor( id : string, entry : CatalogEntry | undefined ) : ServiceRole[]
{
    // 1) authoritative: the role/port block parsed from Ports.ts at runtime (no rebuild needed)
    const parsed : Record<string, number> | undefined = servicePorts()[ id.toUpperCase() ];
    if ( parsed && globalThis.Object.keys( parsed ).length > 0 )
        return globalThis.Object.entries( parsed ).map( ( [ role, port ] ) => ( { role, port } ) );

    // 2) fall back to the static catalog (e.g. web's 5173, which isn't a Ports.ts namespace)
    if ( entry )
        return globalThis.Object.entries( entry.roles ).map( ( [ role, port ] ) => ( { role, port } ) );

    // 3) unknown service (in apps/core, not in Ports.ts or catalog): one "main" role, port unknown (0)
    return [ { role: "main", port: 0 } ];
}

function buildInfo( id : string ) : ServiceInfo
{
    const dir   : string = serviceDir( id );
    const entry : CatalogEntry | undefined = CATALOG[ id ];
    const pkg   : ReturnType<typeof readPkg> = readPkg( dir );

    const scaffolded : boolean = pkg !== undefined;
    const isFrontend : boolean = entry?.frontend === true;
    const hasBuild   : boolean = Boolean( pkg?.scripts?.build );
    const hasCompose : boolean = existsSync( join( dir, "docker-compose.yml" ) ) || existsSync( join( dir, "docker-compose.yaml" ) );

    const roles    : ServiceRole[] = rolesFor( id, entry );
    const hasPort  = roles.some( r => r.port > 0 );

    return {
        id,
        label : entry?.label ?? id.charAt( 0 ).toUpperCase() + id.slice( 1 ),
        icon  : entry?.icon  ?? "Extension",
        dir,
        roles,
        blurb   : entry?.blurb ?? "Service",
        version : pkg?.version,
        capabilities :
        {
            scaffolded,
            canBuild   : scaffolded && hasBuild,
            canImage   : scaffolded && hasRootDockerfile && !isFrontend,
            canCompose : hasCompose,
            canHealth  : scaffolded && hasPort && !isFrontend,
            isFrontend
        }
    };
}

/** List every deployable service, catalog-ordered (known first, then any extras found on disk). */
export function listServices() : ServiceInfo[]
{
    // every dir under apps/core that is a directory and not excluded
    const onDisk : string[] = existsSync( APPS_CORE )
        ? readdirSync( APPS_CORE ).filter( ( name : string ) =>
        {
            if ( EXCLUDE.has( name ) ) return false;
            try { return statSync( join( APPS_CORE, name ) ).isDirectory(); }
            catch { return false; }
        } )
        : [];

    const onDiskSet : Set<string> = new Set( onDisk );

    // ordered ids = catalog order ∩ on-disk, then any on-disk extras not in the catalog (sorted)
    const ordered : string[] =
    [
        ...CATALOG_ORDER.filter( id => onDiskSet.has( id ) ),
        ...onDisk.filter( id => !CATALOG_ORDER.includes( id ) ).sort()
    ];

    return ordered.map( buildInfo );
}

/** Look up one service (used by the pipeline/health to resolve dir, roles, capabilities). */
export function getService( id : string ) : ServiceInfo | undefined
{
    if ( EXCLUDE.has( id ) ) return undefined;
    if ( !existsSync( serviceDir( id ) ) ) return undefined;
    return buildInfo( id );
}
