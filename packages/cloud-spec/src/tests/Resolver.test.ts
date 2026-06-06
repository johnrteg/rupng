//
import { CloudResolver } from '../Resolver';
import { Environment } from '../Environment';
import { ResourceKind } from '../Common';

// Inject a fake identifier source instead of process.env (the constructor supports it).
const source : Record<string, string | undefined> = {
    QUEUE_IMPORT : 'https://sqs.local/000/import',
    BUCKET_FILES : 'dev-auth-bucket-files',
    TABLE_WIDGETS: 'dev-auth-table-widgets',
    QUEUE_EMPTY  : '',                                   // present but empty -> treated as missing
};

function resolver() : CloudResolver
{
    return new CloudResolver( Environment.DEV, 'auth', source );
}

describe('CloudResolver', () => {

    describe('typed accessors map a logical key to the right env var', () => {
        test('queueUrl -> QUEUE_<key>', () => {
            expect( resolver().queueUrl( 'import' ) ).toBe( source.QUEUE_IMPORT );
        });
        test('bucketName -> BUCKET_<key>', () => {
            expect( resolver().bucketName( 'files' ) ).toBe( source.BUCKET_FILES );
        });
        test('tableName -> TABLE_<key>', () => {
            expect( resolver().tableName( 'widgets' ) ).toBe( source.TABLE_WIDGETS );
        });
    });

    describe('lookup (optional)', () => {
        test('returns the value when present', () => {
            expect( resolver().lookup( ResourceKind.QUEUE, 'import' ) ).toBe( source.QUEUE_IMPORT );
        });
        test('returns undefined when absent (does not throw)', () => {
            expect( resolver().lookup( ResourceKind.QUEUE, 'missing' ) ).toBeUndefined();
        });
    });

    describe('require (fail-fast)', () => {
        test('returns the value when present', () => {
            expect( resolver().require( ResourceKind.BUCKET, 'files' ) ).toBe( source.BUCKET_FILES );
        });
        test('throws (with the env var name) when absent', () => {
            expect( () => resolver().require( ResourceKind.QUEUE, 'missing' ) )
                .toThrow( /missing resource identifier 'QUEUE_MISSING'/ );
        });
        test('throws when present but empty', () => {
            expect( () => resolver().require( ResourceKind.QUEUE, 'empty' ) )
                .toThrow( /QUEUE_EMPTY/ );
        });
        test('error names the environment and service', () => {
            expect( () => resolver().require( ResourceKind.QUEUE, 'missing' ) )
                .toThrow( /\[dev\/auth\]/ );
        });
    });

    test('defaults its source to process.env', () => {
        process.env.QUEUE_FROMENV = 'from-process-env';
        const r : CloudResolver = new CloudResolver( Environment.DEV, 'auth' );
        expect( r.queueUrl( 'fromenv' ) ).toBe( 'from-process-env' );
        delete process.env.QUEUE_FROMENV;
    });
});
