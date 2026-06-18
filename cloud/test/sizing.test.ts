//
// Unit tests for the 1..10 -> concrete-AWS-size mappers. These are pure functions; no CDK.
//
import {
    fargateSize, rdsInstanceClass, auroraAcu, mskInstanceType,
    cacheLimits, batchSize, searchInstanceType, searchOcu,
} from '../src/lib/sizing';
import { Sizing, Scale } from '@repo/cloud-manifest';

describe('sizing mappers', () => {

    describe('fargateSize', () => {
        test('default (undefined -> scale 3) yields a valid cpu/memory combo', () => {
            expect( fargateSize( undefined ) ).toEqual( { cpu: 512, memoryMiB: 2048 } );
        });
        test('scale 1 -> smallest', () => {
            expect( fargateSize( { size: 1 } ) ).toEqual( { cpu: 256, memoryMiB: 512 } );
        });
        test('scale 10 -> largest', () => {
            expect( fargateSize( { size: 10 } ) ).toEqual( { cpu: 16384, memoryMiB: 122880 } );
        });
    });

    describe('rdsInstanceClass', () => {
        test('boundaries map to the ends of the ladder', () => {
            expect( rdsInstanceClass( { size: 1 } ) ).toBe( 't4g.micro' );
            expect( rdsInstanceClass( { size: 10 } ) ).toBe( 'r6g.16xlarge' );
        });
        test('uses the larger of cpu/memory', () => {
            expect( rdsInstanceClass( { cpu: 1, memory: 10 } ) ).toBe( 'r6g.16xlarge' );
        });
    });

    describe('auroraAcu', () => {
        test('boundaries', () => {
            expect( auroraAcu( { size: 1 } ) ).toEqual( { min: 0.5, max: 1 } );
            expect( auroraAcu( { size: 10 } ) ).toEqual( { min: 64, max: 256 } );
        });
        test('min never exceeds max across the whole scale', () => {
            for( let s = 1; s <= 10; s++ )
            {
                const acu = auroraAcu( { size: s as Scale } );
                expect( acu.min ).toBeLessThanOrEqual( acu.max );
            }
        });
    });

    test('mskInstanceType boundaries', () => {
        expect( mskInstanceType( { size: 1 } ) ).toBe( 'kafka.t3.small' );
        expect( mskInstanceType( { size: 10 } ) ).toBe( 'kafka.m5.24xlarge' );
    });

    test('cacheLimits boundaries', () => {
        expect( cacheLimits( { size: 1 } ) ).toEqual( { storageGB: 1, ecpu: 1000 } );
        expect( cacheLimits( { size: 10 } ) ).toEqual( { storageGB: 1000, ecpu: 1000000 } );
    });

    test('batchSize boundaries', () => {
        expect( batchSize( { size: 1 } ) ).toEqual( { vcpu: 1, memoryMiB: 2048 } );
        expect( batchSize( { size: 10 } ) ).toEqual( { vcpu: 16, memoryMiB: 65536 } );
    });

    test('searchInstanceType + searchOcu boundaries', () => {
        expect( searchInstanceType( { size: 1 } ) ).toBe( 't3.small.search' );
        expect( searchInstanceType( { size: 10 } ) ).toBe( 'r6g.16xlarge.search' );
        expect( searchOcu( { size: 1 } ) ).toBe( 2 );
        expect( searchOcu( { size: 10 } ) ).toBe( 50 );
    });

    describe('scale clamping (at)', () => {
        test('below 1 clamps to the smallest', () => {
            expect( rdsInstanceClass( { size: 0 as Scale } ) ).toBe( 't4g.micro' );
        });
        test('above 10 clamps to the largest', () => {
            expect( rdsInstanceClass( { size: 99 as Scale } ) ).toBe( 'r6g.16xlarge' );
        });
    });

    test('a typed Sizing flows through', () => {
        const s : Sizing = { cpu: 6, memory: 7 };
        expect( () => fargateSize( s ) ).not.toThrow();
    });
});
