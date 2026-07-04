//
// FastifyLog — adapts our `Trace` to Fastify's logger interface (`FastifyBaseLogger`, a Pino-shaped
// logger). Passed to Fastify via `loggerInstance` so everything Fastify would otherwise print to
// stdout as its own Pino JSON instead flows through `this.log` (one consistent record format the
// monitor service can ingest). Pino log methods are overloaded — `(obj, msg, …)` OR `(msg, …)` — so
// we normalize both into Trace's `(message, ...args)` form, carrying any merge-object/child bindings
// as structured args.
//
import type { FastifyBaseLogger } from 'fastify';

import type { Trace } from './Trace';


// Pino → Trace level routing: fatal/error → error, warn → warn, everything else → info.
type Sink = 'info' | 'warn' | 'error';

/** Split a Pino-style call (object-first or message-first) into Trace's (message, ...args). */
function normalize( bindings : object | undefined, call : Array<unknown> ) : [ string, Array<unknown> ]
{
    let obj  : object | undefined;
    let msg  : string = '';
    let rest : Array<unknown> = [];

    if( typeof call[ 0 ] === 'string' )
    {
        msg  = call[ 0 ];
        rest = call.slice( 1 );
    }
    else if( call[ 0 ] !== undefined )
    {
        obj = call[ 0 ] as object;
        if( typeof call[ 1 ] === 'string' ) { msg = call[ 1 ]; rest = call.slice( 2 ); }
        else                                 { rest = call.slice( 1 ); }
    }

    const args : Array<unknown> = [];
    if( bindings && Object.keys( bindings ).length > 0 ) args.push( bindings );
    if( obj ) args.push( obj );
    args.push( ...rest );

    return [ msg, args ];
}

/**
 * Build a `FastifyBaseLogger` that writes through `log` (a `Trace`). `child(bindings)` returns a
 * logger that prepends those bindings (e.g. a request/transaction id) to every record's args.
 */
export function fastifyLogger( log : Trace ) : FastifyBaseLogger
{
    const build = ( bindings ? : object ) : FastifyBaseLogger =>
    {
        const route = ( sink : Sink ) => ( ...call : Array<unknown> ) : void =>
        {
            const [ msg, args ] = normalize( bindings, call );
            log[ sink ]( msg, ...args );
        };

        // single controlled cast at the adapter boundary: our handlers are plain variadic fns while
        // FastifyLogFn is an overloaded signature — behavior matches, types can't express it directly.
        return {
            level  : 'info',
            silent : () => { /* no-op */ },
            fatal  : route( 'error' ),
            error  : route( 'error' ),
            warn   : route( 'warn' ),
            info   : route( 'info' ),
            debug  : route( 'info' ),
            trace  : route( 'info' ),
            child  : ( childBindings : object ) : FastifyBaseLogger =>
                build( { ...( bindings ?? {} ), ...( childBindings ?? {} ) } ),
        } as unknown as FastifyBaseLogger;
    };

    return build();
}

export default fastifyLogger;
