//
import { scales, Sizing, ResolvedScale } from '../Sizing';

describe('scales', () => {

    test('undefined -> default scale 3 on both axes', () => {
        expect( scales( undefined ) ).toEqual<ResolvedScale>( { cpu: 3, memory: 3 } );
    });

    test('size shorthand applies to both cpu and memory', () => {
        expect( scales( { size: 5 } ) ).toEqual<ResolvedScale>( { cpu: 5, memory: 5 } );
    });

    test('explicit cpu overrides; memory falls back to default (no size)', () => {
        expect( scales( { cpu: 7 } ) ).toEqual<ResolvedScale>( { cpu: 7, memory: 3 } );
    });

    test('explicit memory overrides; cpu falls back to default', () => {
        expect( scales( { memory: 9 } ) ).toEqual<ResolvedScale>( { cpu: 3, memory: 9 } );
    });

    test('size is the fallback for the axis not explicitly set', () => {
        const s : Sizing = { size: 8, cpu: 2 };
        expect( scales( s ) ).toEqual<ResolvedScale>( { cpu: 2, memory: 8 } );
    });
});
