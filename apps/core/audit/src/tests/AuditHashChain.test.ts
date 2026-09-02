//
import { AuditHashChain } from '../AuditHashChain';
import { Audit } from '../AuditModel';
import { Events } from '@repo/system';

function event( occurredAt : string ) : Audit.Event
{
    return {
        version: '1',
        eventId: `evt_${occurredAt}`,
        occurredAt,
        accountId: 'acct_1',
        actor: { kind: Events.ActorKind.USER, id: 'usr_1' },
        object: Events.Object.AUTH_SESSION,
        verb: Events.Verb.CREATED,
        action: Events.actionOf( Events.Object.AUTH_SESSION, Events.Verb.CREATED ),
        target: { type: 'session', id: 'usr_1' },
        source: { channel: Events.SourceChannel.UI },
        outcome: Events.Outcome.SUCCESS,
    };
}

describe( 'AuditHashChain', () => {

    describe( 'eventSk', () => {
        test( 'zero-pads to 12 digits for lexicographic sort', () => {
            expect( AuditHashChain.eventSk( 1 ) ).toBe( 'EVT#000000000001' );
            expect( AuditHashChain.eventSk( 42 ) ).toBe( 'EVT#000000000042' );
        } );
    } );

    describe( 'canonicalize', () => {
        test( 'is stable regardless of property insertion order', () => {
            const a = event( '2026-01-01T00:00:00Z' );
            const b = { ...a };   // same values, but constructed via spread — same key order either way here,
                                    // so assert against a genuinely reordered object literal below instead.
            const reordered : Audit.Event = { outcome: a.outcome, source: a.source, target: a.target, action: a.action, verb: a.verb, object: a.object, actor: a.actor, accountId: a.accountId, occurredAt: a.occurredAt, eventId: a.eventId, version: a.version };
            expect( AuditHashChain.canonicalize( a ) ).toBe( AuditHashChain.canonicalize( reordered ) );
            expect( AuditHashChain.canonicalize( a ) ).toBe( AuditHashChain.canonicalize( b ) );
        } );

        test( 'differs when a field differs', () => {
            const a = event( '2026-01-01T00:00:00Z' );
            const c = event( '2026-01-01T00:00:01Z' );
            expect( AuditHashChain.canonicalize( a ) ).not.toBe( AuditHashChain.canonicalize( c ) );
        } );
    } );

    describe( 'hashOf', () => {
        test( 'genesis case: prevHash="" still produces a deterministic hash', () => {
            const e = event( '2026-01-01T00:00:00Z' );
            const h1 = AuditHashChain.hashOf( '', e );
            const h2 = AuditHashChain.hashOf( '', e );
            expect( h1 ).toBe( h2 );
            expect( h1 ).toHaveLength( 64 );   // sha256 hex digest
        } );

        test( 'chained case: the same event hashes differently under a different prevHash', () => {
            const e = event( '2026-01-01T00:00:00Z' );
            const fromGenesis = AuditHashChain.hashOf( '', e );
            const fromChained = AuditHashChain.hashOf( 'somePriorHash', e );
            expect( fromGenesis ).not.toBe( fromChained );
        } );

        test( 'tamper-detection: editing the event after the fact breaks the recomputed hash', () => {
            const original = event( '2026-01-01T00:00:00Z' );
            const prevHash = '';
            const hash = AuditHashChain.hashOf( prevHash, original );

            // an attacker (or a bug) mutates a field post-hoc — recomputing must NOT match anymore.
            const tampered : Audit.Event = { ...original, outcome: Events.Outcome.FAILURE };
            const recomputed = AuditHashChain.hashOf( prevHash, tampered );
            expect( recomputed ).not.toBe( hash );
        } );

        test( 'a 3-record chain: each link depends on the one before it', () => {
            const e1 = event( '2026-01-01T00:00:00Z' );
            const e2 = event( '2026-01-01T00:00:01Z' );
            const e3 = event( '2026-01-01T00:00:02Z' );

            const h1 = AuditHashChain.hashOf( '', e1 );
            const h2 = AuditHashChain.hashOf( h1, e2 );
            const h3 = AuditHashChain.hashOf( h2, e3 );

            // recomputing from the recorded prevHash chain reproduces the same hashes (verify-on-read).
            expect( AuditHashChain.hashOf( '', e1 ) ).toBe( h1 );
            expect( AuditHashChain.hashOf( h1, e2 ) ).toBe( h2 );
            expect( AuditHashChain.hashOf( h2, e3 ) ).toBe( h3 );

            // but skipping a link (verifying e3 against h1 instead of h2) does NOT reproduce h3 —
            // exactly the property that makes a deleted/reordered record detectable.
            expect( AuditHashChain.hashOf( h1, e3 ) ).not.toBe( h3 );
        } );
    } );
} );
