//
// Unit tests for the LocalStack capability helpers (pure; the DestroyAll aspect is exercised
// via synth, not here).
//
import { isLocal, supportedLocally, LOCAL_UNSUPPORTED } from '../lib/local';
import { Environment, ResourceKind } from '@repo/cloud-spec';

describe('local helpers', () => {

    describe('isLocal', () => {
        test('true only for the LOCAL environment', () => {
            expect( isLocal( Environment.LOCAL ) ).toBe( true );
            expect( isLocal( Environment.DEV ) ).toBe( false );
            expect( isLocal( Environment.STAGING ) ).toBe( false );
            expect( isLocal( Environment.PRODUCTION ) ).toBe( false );
        });
    });

    describe('supportedLocally', () => {
        test('workhorse kinds are emulated', () => {
            expect( supportedLocally( ResourceKind.QUEUE ) ).toBe( true );
            expect( supportedLocally( ResourceKind.BUCKET ) ).toBe( true );
            expect( supportedLocally( ResourceKind.TABLE ) ).toBe( true );
            expect( supportedLocally( ResourceKind.DATABASE ) ).toBe( true );
        });
        test('LocalStack-unsupported kinds are not', () => {
            expect( supportedLocally( ResourceKind.MEDIACONVERT ) ).toBe( false );
            expect( supportedLocally( ResourceKind.RUM ) ).toBe( false );
            expect( supportedLocally( ResourceKind.AMPLIFY ) ).toBe( false );
        });
    });

    test('LOCAL_UNSUPPORTED is exactly the three unsupported kinds', () => {
        expect( LOCAL_UNSUPPORTED.size ).toBe( 3 );
        expect( LOCAL_UNSUPPORTED.has( ResourceKind.MEDIACONVERT ) ).toBe( true );
        expect( LOCAL_UNSUPPORTED.has( ResourceKind.QUEUE ) ).toBe( false );
    });
});
