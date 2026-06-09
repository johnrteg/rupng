import ByteUtils from '../utils/ByteUtils';

describe('ByteUtils', () => {
    test('unit constants (binary, 1024-based)', () => {
        expect( ByteUtils.KB ).toBe( 1024 );
        expect( ByteUtils.MB ).toBe( 1024 * 1024 );
        expect( ByteUtils.GB ).toBe( 1024 * 1024 * 1024 );
        expect( ByteUtils.TB ).toBe( 1024 * 1024 * 1024 * 1024 );
    });

    test('toString — bytes / KB / MB / GB / TB', () => {
        expect( ByteUtils.toString( 0 ) ).toBe( '0 B' );
        expect( ByteUtils.toString( 512 ) ).toBe( '512.0 B' );
        expect( ByteUtils.toString( ByteUtils.KB ) ).toBe( '1.0 KB' );
        expect( ByteUtils.toString( 1536 ) ).toBe( '1.5 KB' );
        expect( ByteUtils.toString( ByteUtils.MB ) ).toBe( '1.0 MB' );
        expect( ByteUtils.toString( ByteUtils.GB ) ).toBe( '1.0 GB' );
        expect( ByteUtils.toString( ByteUtils.TB ) ).toBe( '1.0 TB' );
    });

    test('toString — decimal precision', () => {
        expect( ByteUtils.toString( 1536, 0 ) ).toBe( '2 KB' );   // rounds
        expect( ByteUtils.toString( 1536, 2 ) ).toBe( '1.50 KB' );
        expect( ByteUtils.toString( 1536, 3 ) ).toBe( '1.500 KB' );
    });

    test('toString — boundary just under 1 KB', () => {
        expect( ByteUtils.toString( 1023 ) ).toBe( '1023.0 B' );
    });
});
