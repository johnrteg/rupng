//
import { physicalName, ssmPath, envVarName } from '../Naming';
import { Environment } from '../Environment';
import { ResourceKind } from '../Common';

describe('Naming', () => {

    describe('physicalName', () => {
        test('joins env-service-kind-key with hyphens', () => {
            expect( physicalName( Environment.DEV, 'auth', ResourceKind.QUEUE, 'import' ) ).toBe( 'dev-auth-queue-import' );
        });

        test('carries the environment prefix (local)', () => {
            expect( physicalName( Environment.LOCAL, 'auth', ResourceKind.BUCKET, 'files' ) ).toBe( 'local-auth-bucket-files' );
            expect( physicalName( Environment.PRODUCTION, 'media', ResourceKind.TABLE, 'assets' ) ).toBe( 'production-media-table-assets' );
        });
    });

    describe('ssmPath', () => {
        test('builds a leading-slash path', () => {
            expect( ssmPath( Environment.DEV, 'auth', ResourceKind.SECRET, 'jwt' ) ).toBe( '/dev/auth/secret/jwt' );
        });
    });

    describe('envVarName', () => {
        test('upper-cases kind_key', () => {
            expect( envVarName( ResourceKind.QUEUE, 'import' ) ).toBe( 'QUEUE_IMPORT' );
        });

        test('normalizes hyphens and dots to underscores', () => {
            expect( envVarName( ResourceKind.QUEUE, 'user-events' ) ).toBe( 'QUEUE_USER_EVENTS' );
            expect( envVarName( ResourceKind.BUCKET, 'files.raw' ) ).toBe( 'BUCKET_FILES_RAW' );
        });

        test('collapses runs of non-alphanumerics into a single underscore', () => {
            expect( envVarName( ResourceKind.TABLE, 'a..b--c' ) ).toBe( 'TABLE_A_B_C' );
        });
    });

    test('CDK side and runtime side agree (same inputs -> matching name + env var)', () => {
        // The naming convention is the contract: the env var the resolver reads is derivable
        // from the same (kind, key) the CDK uses to publish it.
        const kind : ResourceKind = ResourceKind.QUEUE;
        const key  : string       = 'process';
        expect( envVarName( kind, key ) ).toBe( 'QUEUE_PROCESS' );
        expect( physicalName( Environment.DEV, 'widget', kind, key ) ).toBe( 'dev-widget-queue-process' );
    });
});
