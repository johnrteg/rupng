//
// Deployment environments and per-environment configuration.
//

export enum Environment
{
    LOCAL      = "local",       // local cloud dev — deployed to LocalStack (Docker), tiny + disposable
    DEV        = "dev",
    STAGING    = "staging",
    PRODUCTION = "production",
}

/**
 * A value that can vary per environment. Resolve with `forEnv()`:
 * `{ default: 1, production: 5 }` -> 5 in prod, 1 elsewhere.
 */
export type PerEnv<T> = Partial<Record<Environment, T>> & { default?: T };

/** Resolve a PerEnv<T> for a given environment, falling back to `default`. */
export function forEnv<T>( value : PerEnv<T> | T | undefined, env : Environment ) : T | undefined
{
    if( value === undefined ) return undefined;

    // plain value (not a PerEnv map)
    if( typeof value !== "object" || value === null ) return value as T;

    const map = value as PerEnv<T>;
    const hasEnvKeys = Environment.LOCAL in map || Environment.DEV in map || Environment.STAGING in map || Environment.PRODUCTION in map || "default" in map;
    if( !hasEnvKeys ) return value as T;    // it's a T that happens to be an object

    return ( map[env] !== undefined ) ? map[env] : map.default;
}
