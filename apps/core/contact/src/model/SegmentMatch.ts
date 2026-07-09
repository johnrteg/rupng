//
import { Segment, Contact } from "@repo/api";
import type { Type } from "@repo/common";

//
// SegmentMatch — an in-memory evaluator for a `Segment.Query` against a `Contact.Entity`. It powers the
// segment PREVIEW (match a filter against the account's contacts, in-service). Production-scale segment
// evaluation runs against the search service (see contact SPECS); this is the bounded, per-account preview.
//
// It walks the boolean tree (all/any/none, nested) and applies each condition per the field's data type +
// the operator. A few fields can't be derived from the contact row alone (campaign audience, timezone of area
// code); those are treated as NON-constraining in preview (they match) so the preview never wrongly EXCLUDES
// — flagged back to the caller via `unsupportedFields`.
//
export namespace SegmentMatch
{
    /** Evaluation context — the field catalog (for type lookup) + preloaded segment membership (for ref rules). */
    export interface Context
    {
        fields:         Array<Segment.FilterField>;        // built-ins + this account's custom fields
        segmentMembers: Record<string, Set<string>>;       // segmentId → set of member contactIds (for SEGMENT refs)
    }

    /** Field ids that can't be evaluated from a contact row alone in preview — treated as non-constraining. */
    const UNSUPPORTED : ReadonlyArray<string> = [ Segment.FieldId.CAMPAIGN, Segment.FieldId.TIMEZONE_OF_AREA_CODE ];

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Whether a contact matches the query. */
    export function matches( contact : Contact.Entity, query : Segment.Query, context : Context ) : boolean
    {
        return evalGroup( contact, query, context );
    }

    /** A comparable sort key for a contact on a field (number for numeric/date fields, else a lowercased string). */
    export function sortValue( contact : Contact.Entity, fieldId : string, context : Context ) : number | string
    {
        const field : Segment.FilterField | undefined = context.fields.find( ( entry : Segment.FilterField ) : boolean => entry.id === fieldId );
        if( !field ) return "";
        const values : Array<Type.Json> = extractValues( contact, field, context ).filter( ( value : Type.Json ) : boolean => notBlank( value ) );
        const numeric : boolean = field.type === Segment.FilterType.NUMBER || isDate( field.type );
        if( values.length === 0 ) return numeric ? 0 : "";
        const first : Type.Json = values[ 0 ];
        if( field.type === Segment.FilterType.NUMBER ) return Number( first );
        if( isDate( field.type ) ) return timestamp( first );
        return lower( first );
    }

    /** Order matched contacts by a segment's sort (field + direction) — used for preview + the top-N limit. */
    export function orderBy( matches : Array<Contact.Entity>, sort : Segment.Sort, context : Context ) : Array<Contact.Entity>
    {
        const direction : number = sort.direction === Segment.SortDir.DESC ? -1 : 1;
        const copy : Array<Contact.Entity> = [ ...matches ];
        copy.sort( ( first : Contact.Entity, second : Contact.Entity ) : number => compareBy( first, second, sort.field, context, direction ) );
        return copy;
    }

    // comparator for orderBy — compares two contacts on the sort field, applying the direction
    function compareBy( first : Contact.Entity, second : Contact.Entity, fieldId : string, context : Context, direction : number ) : number
    {
        const firstKey : number | string = sortValue( first, fieldId, context );
        const secondKey : number | string = sortValue( second, fieldId, context );
        const order : number = firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0;
        return order * direction;
    }

    /** Which of a query's fields this evaluator can't fully evaluate in preview (for a caller-facing note). */
    export function unsupportedFields( query : Segment.Query ) : Array<string>
    {
        const found : Set<string> = new Set<string>();
        collectUnsupported( query, found );
        return Array.from( found );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // walk a group: all→every, any→some, none→no rule matches. An empty group is non-constraining (matches).
    function evalGroup( contact : Contact.Entity, group : Segment.Group, context : Context ) : boolean
    {
        if( group.conditions.length === 0 ) return true;
        // evaluate each child (a nested group or a leaf condition)
        const results : Array<boolean> = group.conditions.map( ( rule : Segment.Condition | Segment.Group ) : boolean =>
            "op" in rule ? evalGroup( contact, rule, context ) : evalCondition( contact, rule, context ) );
        if( group.op === Segment.GroupOp.ALL )  return results.every( ( value : boolean ) : boolean => value );
        if( group.op === Segment.GroupOp.ANY )  return results.some( ( value : boolean ) : boolean => value );
        return !results.some( ( value : boolean ) : boolean => value );   // NONE
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // evaluate a single condition against the contact
    function evalCondition( contact : Contact.Entity, condition : Segment.Condition, context : Context ) : boolean
    {
        // unknown / unsupported field → non-constraining (don't wrongly exclude)
        if( UNSUPPORTED.includes( condition.field ) ) return true;
        const field : Segment.FilterField | undefined = context.fields.find( ( entry : Segment.FilterField ) : boolean => entry.id === condition.field );
        if( !field ) return true;

        const operator : Segment.Operator = condition.operator;

        // empty / not-empty — based on whether the contact has any value for the field
        if( operator === Segment.Operator.IS_EMPTY || operator === Segment.Operator.IS_NOT_EMPTY )
        {
            const hasValue : boolean = extractValues( contact, field, context ).some( ( value : Type.Json ) : boolean => notBlank( value ) );
            return operator === Segment.Operator.IS_EMPTY ? !hasValue : hasValue;
        }

        // set membership (any/every/none of) — compare the contact's value set to the operand set
        if( operator === Segment.Operator.ANY_OF || operator === Segment.Operator.EVERY_OF || operator === Segment.Operator.NONE_OF )
        {
            const candidates : Set<string> = new Set<string>( extractValues( contact, field, context ).filter( ( value : Type.Json ) : boolean => notBlank( value ) ).map( ( value : Type.Json ) : string => String( value ) ) );
            const operand : Array<string> = ( condition.values ?? [] ).map( ( value : Type.Json ) : string => String( value ) );
            if( operator === Segment.Operator.ANY_OF )   return operand.some(  ( value : string ) : boolean => candidates.has( value ) );
            if( operator === Segment.Operator.EVERY_OF ) return operand.every( ( value : string ) : boolean => candidates.has( value ) );
            return !operand.some( ( value : string ) : boolean => candidates.has( value ) );   // NONE_OF
        }

        // geo distance — contact must have coordinates within the operand circle
        if( operator === Segment.Operator.WITHIN )
        {
            if( contact.latitude === undefined || contact.longitude === undefined ) return false;
            const geo : Segment.GeoWithin | undefined = condition.value as Segment.GeoWithin | undefined;
            if( !geo ) return false;
            const distance : number = haversine( contact.latitude, contact.longitude, geo.lat, geo.lng, geo.unit );
            return distance <= geo.radius;
        }

        // scalar comparisons — match if ANY of the contact's candidate values satisfies the operator
        const candidates : Array<Type.Json> = extractValues( contact, field, context ).filter( ( value : Type.Json ) : boolean => notBlank( value ) );
        return scalarMatch( candidates, operator, condition, field.type );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // scalar operator application over the candidate values (is / is not / contains / begins / ends / </<=/>/>= / between)
    function scalarMatch( candidates : Array<Type.Json>, operator : Segment.Operator, condition : Segment.Condition, type : Segment.FilterType ) : boolean
    {
        const operand : Type.Json = condition.value ?? "";
        switch( operator )
        {
            case Segment.Operator.IS:
                return candidates.some( ( value : Type.Json ) : boolean => equals( value, operand, type ) );
            case Segment.Operator.IS_NOT:
                return !candidates.some( ( value : Type.Json ) : boolean => equals( value, operand, type ) );
            case Segment.Operator.CONTAINS:
                return candidates.some( ( value : Type.Json ) : boolean => lower( value ).includes( lower( operand ) ) );
            case Segment.Operator.BEGINS_WITH:
                return candidates.some( ( value : Type.Json ) : boolean => lower( value ).startsWith( lower( operand ) ) );
            case Segment.Operator.ENDS_WITH:
                return candidates.some( ( value : Type.Json ) : boolean => lower( value ).endsWith( lower( operand ) ) );
            case Segment.Operator.LESS_THAN:
                return candidates.some( ( value : Type.Json ) : boolean => compare( value, operand, type ) < 0 );
            case Segment.Operator.LESS_THAN_OR_EQUAL:
                return candidates.some( ( value : Type.Json ) : boolean => compare( value, operand, type ) <= 0 );
            case Segment.Operator.GREATER_THAN:
                return candidates.some( ( value : Type.Json ) : boolean => compare( value, operand, type ) > 0 );
            case Segment.Operator.GREATER_THAN_OR_EQUAL:
                return candidates.some( ( value : Type.Json ) : boolean => compare( value, operand, type ) >= 0 );
            case Segment.Operator.BETWEEN:
                return betweenMatch( candidates, condition, type );
            default:
                return true;   // unhandled operator → non-constraining
        }
    }

    // BETWEEN — inclusive range [from, to] from `values`
    function betweenMatch( candidates : Array<Type.Json>, condition : Segment.Condition, type : Segment.FilterType ) : boolean
    {
        const from : Type.Json = condition.values?.[ 0 ] ?? "";
        const to : Type.Json = condition.values?.[ 1 ] ?? "";
        return candidates.some( ( value : Type.Json ) : boolean => compare( value, from, type ) >= 0 && compare( value, to, type ) <= 0 );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // pull the contact's candidate value(s) for a field (multi-valued fields return several)
    function extractValues( contact : Contact.Entity, field : Segment.FilterField, context : Context ) : Array<Type.Json>
    {
        // account custom field — value keyed by uid (MULTI_CHOICE stored comma-joined → split to a set)
        if( field.isCustom )
        {
            const raw : string | undefined = contact.customFields?.[ field.id ];
            if( raw === undefined ) return [];
            return field.type === Segment.FilterType.TAGS ? raw.split( "," ) : [ raw ];
        }

        const addresses : Array<Contact.AddressEntry> = contact.addresses ?? [];
        switch( field.id )
        {
            case Segment.FieldId.FIRST_NAME:   return [ contact.firstName ?? "" ];
            case Segment.FieldId.LAST_NAME:    return [ contact.lastName ?? "" ];
            case Segment.FieldId.EMAIL:        return contact.emails.map( ( entry : Contact.EmailEntry ) : Type.Json => entry.value );
            case Segment.FieldId.PHONE_NUMBER: return contact.phones.map( ( entry : Contact.PhoneEntry ) : Type.Json => entry.value );
            case Segment.FieldId.STREET:       return addresses.map( ( entry : Contact.AddressEntry ) : Type.Json => entry.line1 ?? "" );
            case Segment.FieldId.CITY:         return addresses.map( ( entry : Contact.AddressEntry ) : Type.Json => entry.city ?? "" );
            case Segment.FieldId.COUNTY:       return addresses.map( ( entry : Contact.AddressEntry ) : Type.Json => entry.county ?? "" );
            case Segment.FieldId.STATE:        return addresses.map( ( entry : Contact.AddressEntry ) : Type.Json => entry.region ?? "" );
            case Segment.FieldId.ZIP:          return addresses.map( ( entry : Contact.AddressEntry ) : Type.Json => entry.postalCode ?? "" );
            case Segment.FieldId.COUNTRY:      return addresses.map( ( entry : Contact.AddressEntry ) : Type.Json => entry.country ?? "" );
            case Segment.FieldId.TIMEZONE:     return [ contact.tz ?? "" ];
            case Segment.FieldId.AREA_CODE:    return contact.phones.map( ( entry : Contact.PhoneEntry ) : Type.Json => areaCode( entry.value ) );
            case Segment.FieldId.PHONE_COUNTRY_CODE: return contact.phones.map( ( entry : Contact.PhoneEntry ) : Type.Json => countryCode( entry.value ) );
            case Segment.FieldId.TAGS:         return ( contact.tags ?? [] ).map( ( tag : Contact.Tag ) : Type.Json => tag.value );
            case Segment.FieldId.IMPORTED_FROM: return Object.keys( contact.externalRefs ?? {} );
            case Segment.FieldId.SEGMENT:      return contactSegments( contact, context );
            case Segment.FieldId.CREATED_DATE:  return [ contact.audit.createdAt ];
            case Segment.FieldId.MODIFIED_DATE: return [ contact.audit.modifiedAt ];
            case Segment.FieldId.LAST_SYNC_AT:  return [ lastSync( contact ) ];
            default:                            return [];
        }
    }

    // the segment ids this contact belongs to (from preloaded membership; falls back to the contact's cache)
    function contactSegments( contact : Contact.Entity, context : Context ) : Array<Type.Json>
    {
        const belongs : Array<string> = [];
        for( const segmentId of Object.keys( context.segmentMembers ) )
            if( context.segmentMembers[ segmentId ]?.has( contact.id ) ) belongs.push( segmentId );
        // include the contact's cached membership too (covers segments not preloaded)
        for( const segmentId of contact.segmentIds ?? [] )
            if( !belongs.includes( segmentId ) ) belongs.push( segmentId );
        return belongs;
    }

    // the most recent external-ref sync time (for the "last sync" date field)
    function lastSync( contact : Contact.Entity ) : Type.Json
    {
        const times : Array<string> = Object.values( contact.externalRefs ?? {} )
            .map( ( ref : Contact.ExternalRef ) : string => ref.lastSyncAt ?? "" )
            .filter( ( value : string ) : boolean => value !== "" );
        if( times.length === 0 ) return "";
        return times.reduce( ( best : string, value : string ) : string => value > best ? value : best );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // value helpers
    function notBlank( value : Type.Json ) : boolean
    {
        return value !== undefined && value !== null && String( value ).trim() !== "";
    }
    function lower( value : Type.Json ) : string
    {
        return String( value ?? "" ).toLowerCase();
    }
    function equals( value : Type.Json, operand : Type.Json, type : Segment.FilterType ) : boolean
    {
        if( type === Segment.FilterType.NUMBER )   return Number( value ) === Number( operand );
        if( type === Segment.FilterType.BOOLEAN )  return Boolean( value ) === Boolean( operand );
        if( isDate( type ) )                        return timestamp( value ) === timestamp( operand );
        return lower( value ) === lower( operand );
    }
    // -1 / 0 / 1 comparison honoring the field type (dates by time, numbers numerically, else string)
    function compare( value : Type.Json, operand : Type.Json, type : Segment.FilterType ) : number
    {
        if( type === Segment.FilterType.NUMBER )
        {
            const difference : number = Number( value ) - Number( operand );
            return difference < 0 ? -1 : difference > 0 ? 1 : 0;
        }
        if( isDate( type ) )
        {
            const difference : number = timestamp( value ) - timestamp( operand );
            return difference < 0 ? -1 : difference > 0 ? 1 : 0;
        }
        return lower( value ).localeCompare( lower( operand ) );
    }
    function isDate( type : Segment.FilterType ) : boolean
    {
        return type === Segment.FilterType.DATE || type === Segment.FilterType.DATETIME;
    }
    function timestamp( value : Type.Json ) : number
    {
        const time : number = new Date( String( value ) ).getTime();
        return Number.isNaN( time ) ? 0 : time;
    }

    // area code — the 3 digits after the +1 country code of a US/CA E.164 number (best-effort in preview)
    function areaCode( phone : Type.PhoneE164 ) : Type.Json
    {
        const text : string = String( phone );
        if( text.startsWith( "+1" ) && text.length >= 5 ) return text.slice( 2, 5 );
        return "";
    }
    // phone country code — the leading E.164 country code (best-effort: +1 recognized; else the first digit run)
    function countryCode( phone : Type.PhoneE164 ) : Type.Json
    {
        const text : string = String( phone );
        if( !text.startsWith( "+" ) ) return "";
        if( text.startsWith( "+1" ) ) return "1";
        const digits : string = text.slice( 1 );
        return digits.slice( 0, 2 );   // approximate for non-NANP numbers
    }

    // great-circle distance between two lat/lng points, in the requested unit
    function haversine( lat1 : number, lng1 : number, lat2 : number, lng2 : number, unit : Segment.DistanceUnit ) : number
    {
        const radiusKm : number = 6371;
        const dLat : number = toRad( lat2 - lat1 );
        const dLng : number = toRad( lng2 - lng1 );
        const sinLat : number = Math.sin( dLat / 2 );
        const sinLng : number = Math.sin( dLng / 2 );
        const a : number = sinLat * sinLat + Math.cos( toRad( lat1 ) ) * Math.cos( toRad( lat2 ) ) * sinLng * sinLng;
        const c : number = 2 * Math.atan2( Math.sqrt( a ), Math.sqrt( 1 - a ) );
        const km : number = radiusKm * c;
        return unit === Segment.DistanceUnit.MILES ? km * 0.621371 : km;
    }
    function toRad( degrees : number ) : number { return degrees * Math.PI / 180; }

    // recursively collect the query's unsupported field ids (for the caller-facing preview note)
    function collectUnsupported( group : Segment.Group, found : Set<string> ) : void
    {
        for( const rule of group.conditions )
        {
            if( "op" in rule ) collectUnsupported( rule, found );
            else if( UNSUPPORTED.includes( rule.field ) ) found.add( rule.field );
        }
    }
}

export default SegmentMatch;
