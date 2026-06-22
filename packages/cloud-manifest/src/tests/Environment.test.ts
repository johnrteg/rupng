//
import { Environment, forEnv, PerEnv } from '../Environment';

describe('forEnv', () => {

    test('undefined input -> undefined', () => {
        expect( forEnv( undefined, Environment.DEV ) ).toBeUndefined();
    });

    test('plain scalar passes through unchanged', () => {
        expect( forEnv( 'us-east-1', Environment.DEV ) ).toBe( 'us-east-1' );
        expect( forEnv( 5, Environment.PRODUCTION ) ).toBe( 5 );
    });

    test('falsy scalars are preserved (not treated as missing)', () => {
        expect( forEnv( 0, Environment.DEV ) ).toBe( 0 );
        expect( forEnv( false, Environment.DEV ) ).toBe( false );
    });

    test('resolves the matching environment key', () => {
        const v : PerEnv<number> = { default: 1, production: 5 };
        expect( forEnv( v, Environment.PRODUCTION ) ).toBe( 5 );
    });

    test('falls back to default when the env key is absent', () => {
        const v : PerEnv<number> = { default: 1, production: 5 };
        expect( forEnv( v, Environment.DEV ) ).toBe( 1 );
    });

    test('returns undefined when neither the env key nor a default exists', () => {
        const v : PerEnv<number> = { production: 5 };
        expect( forEnv( v, Environment.DEV ) ).toBeUndefined();
    });

    test('recognizes the local environment key', () => {
        const v : PerEnv<number> = { local: 2, default: 1 };
        expect( forEnv( v, Environment.LOCAL ) ).toBe( 2 );
        expect( forEnv( v, Environment.DEV ) ).toBe( 1 );
    });

    test('an object with no env keys is treated as a plain value (passthrough)', () => {
        // e.g. a Sizing object { cpu, memory } is itself the value, not a PerEnv map.
        const sizing = { cpu: 3, memory: 4 };
        expect( forEnv( sizing as unknown as PerEnv<typeof sizing>, Environment.DEV ) ).toBe( sizing );
    });
});
