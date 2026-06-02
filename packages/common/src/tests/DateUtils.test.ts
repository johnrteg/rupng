import DateUtils from '../utils/DateUtils';

describe('DateUtils', () => {
    test('parse various date formats', () => {
        //console.log( DateUtils.parse(1753059107136) );
        expect( DateUtils.parse( 1753059107136 )?.toISOString() ).toBe( "2025-07-21T00:51:47.136Z" );
        expect( DateUtils.parse( 1753059107136568 )?.toISOString() ).toBe( "2025-07-21T00:51:47.136Z" );
        expect( DateUtils.parse( "2025-07-21T00:51:47.136Z" )?.toISOString() ).toBe( "2025-07-21T00:51:47.136Z" );
    });

    test('startOfDay/endOfDay', () => {
        const date : Date = new Date(Date.UTC(2025, 6, 21, 0, 51, 47, 136)); // July is month 6 (0-based)
        if( date !== null )
        {
            const start : Date = DateUtils.startOfDay( date );
            const end   : Date = DateUtils.endOfDay( date );

            expect( start.getHours() ).toBe( 0 );
            expect( start.getMinutes() ).toBe( 0 );
            expect( start.getSeconds() ).toBe( 0 );
            expect( start.getMilliseconds() ).toBe( 0 );

            expect( end.getHours() ).toBe( 23 );
            expect( end.getMinutes() ).toBe( 59 );
            expect( end.getSeconds() ).toBe( 59 );
            expect( end.getMilliseconds() ).toBe( 999 );
        }
    });

    test('toYYYYMMDD', () => {
        const date : Date | null = DateUtils.parse( 1753059107136 );
        if( date !== null )
        {
            expect( DateUtils.toIsoDate( date ) ).toBe( "2025-07-21" );
        }
    });

    test('addDays', () => {
        const date : Date | null = DateUtils.parse( 1753059107136 );
        if( date !== null )
        {
            expect( DateUtils.toIsoDate(  DateUtils.addDays( date, 1 ) ) ).toBe( "2025-07-22" );
        }
    });


});

describe('DateUtils.between', () => {
    const start  : Date = new Date('2025-01-01T00:00:00Z');
    const end    : Date = new Date('2025-12-31T23:59:59Z');
    const inside : Date = new Date('2025-06-15T12:00:00Z');
    const before : Date = new Date('2024-12-31T23:59:59Z');
    const after  : Date = new Date('2026-01-01T00:00:00Z');

    it('returns true if date is null', () => {
        expect(DateUtils.between(start, end, null)).toBe(true);
    });

    it('returns true if date is within start and end', () => {
        expect(DateUtils.between(start, end, inside)).toBe(true);
    });

    it('returns false if date is before start_date', () => {
        expect(DateUtils.between(start, end, before)).toBe(false);
    });

    it('returns false if date is after end_date', () => {
        expect(DateUtils.between(start, end, after)).toBe(false);
    });

    it('returns true if start_date is null and date is before end_date', () => {
        expect(DateUtils.between(null, end, inside)).toBe(true);
        expect(DateUtils.between(null, end, before)).toBe(true);
    });

    it('returns true if end_date is null and date is after start_date', () => {
        expect(DateUtils.between(start, null, inside)).toBe(true);
        expect(DateUtils.between(start, null, after)).toBe(true);
    });

    it('returns true if both start_date and end_date are null', () => {
        expect(DateUtils.between(null, null, inside)).toBe(true);
        expect(DateUtils.between(null, null, before)).toBe(true);
        expect(DateUtils.between(null, null, after)).toBe(true);
    });
});

describe('DateUtils.parseTimeTo12HourClock', () => {
    it('converts 21:00 to 09:00 PM', () => {
        expect(DateUtils.parseTimeTo12HourClock('21:00')).toBe('09:00 PM');
    });

    it('converts 10:00 to 10:00 AM', () => {
        expect(DateUtils.parseTimeTo12HourClock('10:00')).toBe('10:00 AM');
    });

    it('converts 00:15 to 12:15 AM', () => {
        expect(DateUtils.parseTimeTo12HourClock('00:15')).toBe('12:15 AM');
    });

    it('converts 12:30 to 12:30 PM', () => {
        expect(DateUtils.parseTimeTo12HourClock('12:30')).toBe('12:30 PM');
    });

    it('converts 01:05 to 01:05 AM', () => {
        expect(DateUtils.parseTimeTo12HourClock('01:05')).toBe('01:05 AM');
    });

    it('returns input if format is invalid', () => {
        expect(DateUtils.parseTimeTo12HourClock('abc')).toBe('abc');
        expect(DateUtils.parseTimeTo12HourClock('25:00')).toBe('01:00 AM'); // Note: 25:00 wraps to 1:00 AM
        expect(DateUtils.parseTimeTo12HourClock('')).toBe('');
    });

    it('trims whitespace before parsing', () => {
        expect(DateUtils.parseTimeTo12HourClock(' 13:45 ')).toBe('01:45 PM');
    });
});