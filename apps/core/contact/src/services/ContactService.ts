//
import { Application, Service, Ports, Register, Dynamo, Kafka, Sqs } from "@repo/services";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulService } from "@repo/endpoint";
import { Events } from "@repo/system";
import { Segment, Contact, PostPrintInternalErase, PostVoiceInternalErase, PostReportInternalErase } from "@repo/api";
import SegmentMatch from "../model/SegmentMatch";

//
// ContactService — the contact domain's Service BASE (not deployed alone). Holds the shared domain wiring
// (DynamoDB + Kafka + SQS facades, version) so the concrete role (ContactMainService) inherits it. The
// light-CRM: contacts + segments in DynamoDB, CRUD over the /contact/* API. Also owns the segment-count
// refresh logic (reachability channelCounts), run off the request path via the contact-segment-refresh queue.
//
export class ContactService extends Service
{
    private _dynamo? : Dynamo;
    private _kafka?  : Kafka;
    private _sqs?    : Sqs;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( role : ContactService.Role )
    {
        // super( serviceId, role, defaultLocalPort ) — env PORT overrides the default when set.
        super( Register.Service.CONTACT, role, ContactService.PORT[ role ] );

        // stamp the running version from package.json (walks up from bin/services at runtime)
        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** DynamoDB facade — the source of truth for contacts + segments. Lazy + cached. */
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }

    /** Kafka facade — CRUD event emission (contact.* topics), best-effort. Lazy + cached. */
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }

    /** SQS facade — the contact-segment-refresh / contact-forget work queues. Lazy + cached. */
    public get sqs() : Sqs { return this._sqs ??= new Sqs( this.cloud ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Publish a `contact.*` lifecycle event. Best-effort — a bus miss is logged, never fails the
     *  caller. `data` is the entity's `@repo/api` wire model; `actorUserId` (if given) makes it a
     *  USER-actored event, else a SERVICE-actored one. */
    public async emit( verb : Events.Verb, targetId : string, accountId : string, data : unknown, actorUserId? : string ) : Promise<void>
    {
        const env : Events.Envelope = Events.envelope( { object: Events.Object.CONTACT_CONTACT, verb, accountId, target: { type: "contact", id: targetId }, data, actorUserId } );
        const published : Type.Result<void> = await this.kafka.publishEvent( env );
        if( !published.ok ) this.log.warn( "contact event publish failed", { action: env.action, targetId, error: published.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Publish a `contact.segment` lifecycle event. Best-effort — a bus miss is logged, never fails the
     *  caller. `data` is the entity's `@repo/api` wire model; `actorUserId` (if given) makes it a
     *  USER-actored event, else a SERVICE-actored one. */
    public async emitSegment( verb : Events.Verb, targetId : string, accountId : string, data : unknown, actorUserId? : string ) : Promise<void>
    {
        const env : Events.Envelope = Events.envelope( { object: Events.Object.CONTACT_SEGMENT, verb, accountId, target: { type: "segment", id: targetId }, data, actorUserId } );
        const published : Type.Result<void> = await this.kafka.publishEvent( env );
        if( !published.ok ) this.log.warn( "segment event publish failed", { action: env.action, targetId, error: published.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Allocate the next per-account sequential reference number for an entity kind (contact | segment; starts
     *  at 1). Atomic + monotonic + never-reused (see `Dynamo.increment`): a burned number on a failed create is
     *  an acceptable gap, and a purged contact/segment never frees its number. The caller stamps the returned
     *  value onto the new row's immutable `ref` field. Returns a Result — a failed allocation aborts the create. */
    public async nextRef( accountId : Type.UUID, kind : ContactService.SequenceKind ) : Promise<Type.Result<number>>
    {
        return this.dynamo.increment( "contact_counters", { accountId, kind }, "n" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Best-effort: enqueue a recompute of the segment counts a contact affects (called on contact
     *  create/update/archive/consent-change). Never fails the caller — a missed refresh self-heals on the
     *  next full segment listing. */
    public async enqueueSegmentRefresh( accountId : string, contactId : string ) : Promise<void>
    {
        const sent : Type.Result<void> = await this.sqs.send( "contact-segment-refresh", { accountId, contactId } );
        if( !sent.ok ) this.log.warn( "segment-refresh enqueue failed", { contactId, error: sent.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Best-effort: enqueue a (re)materialization of a segment's QUERY membership from its saved filter (run off
     *  the request path — evaluating a filter over the contacts partition can exceed the inline budget). */
    public async enqueueSegmentMaterialize( accountId : string, segmentId : string, trigger : Segment.RunTrigger, actorUserId? : string ) : Promise<void>
    {
        const sent : Type.Result<void> = await this.sqs.send( "contact-segment-materialize", { accountId, segmentId, trigger, actorUserId } );
        if( !sent.ok ) this.log.warn( "segment-materialize enqueue failed", { segmentId, error: sent.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── GDPR forget (contact-10.3) ────────────────────────────────────────────────────────────

    /** Enqueue a forget request — the worker does the redaction + fan-out off the request path
     *  (a multi-service fan-out can exceed the inline request budget). */
    public async enqueueForget( accountId : string, contactId : string, actorUserId : string, reason? : string ) : Promise<Type.Result<void>>
    {
        return this.sqs.send( "contact-forget", { accountId, contactId, actorUserId, reason } );
    }

    /** WORKER: redact the contact to a tombstone shell, fan the erasure out to every content-holding
     *  service's `/internal/erase` S2S hook, publish `contact.contact` PURGED, and refresh the
     *  contact's segments (a forgotten contact drops out of reachable counts). Idempotent — forgetting
     *  an already-forgotten contact re-runs harmlessly (redaction of already-empty fields is a no-op). */
    public async processForget( accountId : string, contactId : string, actorUserId : string, reason? : string ) : Promise<void>
    {
        const got : Type.Result<Contact.Entity | undefined> = await this.dynamo.get<Contact.Entity>( "contacts", { accountId, contactId } );
        if( !got.ok || !got.data ) { this.log.warn( "forget: contact not found", { accountId, contactId } ); return; }
        const current : Contact.Entity = ObjectUtils.withDefaults( got.data, Contact.DEFAULT );

        // fan out to content-holding services BEFORE clearing our own PII — voice keys erasure by
        // phone number, so the numbers must still be on the row when we call it
        await this.eraseFromContentServices( accountId, contactId, current.phones.map( ( entry : Contact.PhoneEntry ) : string => entry.value ) );

        const now : Type.ISODateTime = new Date().toISOString();
        const redacted : Contact.Entity =
        {
            ...current,
            firstName: undefined, lastName: undefined, emails: [], phones: [], addresses: undefined,
            link: undefined, social: undefined, externalRefs: undefined, notes: undefined, customFields: undefined,
            status: Contact.ContactStatus.FORGOTTEN,
            forgotten: { at: now, by: actorUserId, reason },
            audit: { ...current.audit, modifiedAt: now, modifiedBy: actorUserId },
        };

        const wrote : Type.Result<void> = await this.dynamo.put( "contacts", { ...redacted, contactId } );
        if( !wrote.ok ) { this.log.error( "forget: tombstone write failed", { accountId, contactId, error: wrote.error } ); return; }

        await this.emit( Events.Verb.PURGED, contactId, accountId, redacted, actorUserId );
        await this.audit( { action: "contact.contact.purged", accountId, target: { type: "contact", id: contactId }, actorUserId, context: reason ? { reason } : undefined } );
        void this.enqueueSegmentRefresh( accountId, contactId );
        this.log.info( "contact forgotten", { accountId, contactId } );
    }

    /** Best-effort fan-out to every service known to hold this contact's content (print-7.1,
     *  voice-?, report-11.1). A target's failure is logged, never blocks the others or the
     *  tombstone write — this is why the redaction step ABOVE doesn't depend on this succeeding. */
    private async eraseFromContentServices( accountId : string, contactId : string, phones : Array<string> ) : Promise<void>
    {
        const print : RestfulService = new RestfulService( process.env.PRINT_INTERNAL_URL ?? NetworkUtils.url( NetworkUtils.Protocol.HTTP, "localhost", Ports.PRINT.MAIN, null, null ) );
        const report : RestfulService = new RestfulService( process.env.REPORT_INTERNAL_URL ?? NetworkUtils.url( NetworkUtils.Protocol.HTTP, "localhost", Ports.REPORT.MAIN, null, null ) );
        const voice : RestfulService = new RestfulService( process.env.VOICE_INTERNAL_URL ?? NetworkUtils.url( NetworkUtils.Protocol.HTTP, "localhost", Ports.VOICE.MAIN, null, null ) );

        const printReply : RestfulService.Reply<PostPrintInternalErase.Response> = await print.fetch( new PostPrintInternalErase( { accountId, contactId } ) );
        if( !printReply.ok ) this.log.warn( "forget fan-out: print erase failed", { accountId, contactId, status: printReply.status } );

        const reportReply : RestfulService.Reply<PostReportInternalErase.Response> = await report.fetch( new PostReportInternalErase( { accountId, subjectId: contactId } ) );
        if( !reportReply.ok ) this.log.warn( "forget fan-out: report erase failed", { accountId, contactId, status: reportReply.status } );

        // voice keys erasure by phone number (its call log has no contactId column) — one call per number
        for( const to of phones )
        {
            const voiceReply : RestfulService.Reply<PostVoiceInternalErase.Response> = await voice.fetch( new PostVoiceInternalErase( { accountId, to } ) );
            if( !voiceReply.ok ) this.log.warn( "forget fan-out: voice erase failed", { accountId, to, status: voiceReply.status } );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Evaluate a segment query against the account's contacts (in-service, bounded per account). Returns the
     *  matching contacts + the eval context (field catalog + preloaded membership) + fields not fully evaluable.
     *  Shared by the segment PREVIEW endpoint and the materialize job. */
    public async evaluateQuery( accountId : string, query : Segment.Query ) : Promise<Type.Result<ContactService.Evaluation>>
    {
        // the evaluation set — the account's contacts
        const contacts : Type.Result<Array<Contact.Entity>> = await this.dynamo.query<Contact.Entity>( "contacts", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !contacts.ok ) return { ok: false, error: contacts.error };

        // the field catalog = built-ins + this account's custom fields (for type-aware evaluation)
        const defs : Type.Result<Array<Contact.CustomFieldDef>> = await this.dynamo.query<Contact.CustomFieldDef>( "field_defs", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        const customFields : Array<Segment.FilterField> = defs.ok ? defs.data.map( ( def : Contact.CustomFieldDef ) : Segment.FilterField => Segment.customField( def ) ) : [];
        const fields : Array<Segment.FilterField> = [ ...Segment.FIELDS, ...customFields ];

        // preload membership of any referenced segments (for "belongs to segment" rules), then evaluate
        const segmentMembers : Record<string, Set<string>> = await this.loadReferencedMembers( accountId, query );
        const context : SegmentMatch.Context = { fields, segmentMembers };
        const matches : Array<Contact.Entity> = contacts.data.filter( ( contact : Contact.Entity ) : boolean => SegmentMatch.matches( contact, query, context ) );
        const unsupported : Array<string> = SegmentMatch.unsupportedFields( query );
        return { ok: true, data: { matches, context, unsupported } };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** WORKER: (re)materialize a segment's QUERY membership from its saved filter — reconcile the QUERY-sourced
     *  join rows to the current matches (honoring the segment's sort + top-N limit), then recount. MANUAL /
     *  IMPORT members are left untouched. A segment WITHOUT a real filter (e.g. import-sourced) just gets a
     *  count refresh — its membership is owned by the importer, not derived here. */
    public async materializeSegment( accountId : string, segmentId : string, trigger : Segment.RunTrigger = Segment.RunTrigger.REFRESH, actorUserId? : string ) : Promise<void>
    {
        const segment : Type.Result<Segment.Entity | undefined> = await this.dynamo.get<Segment.Entity>( "segments", { accountId, segmentId } );
        if( !segment.ok || !segment.data ) return;

        // no real filter → don't derive membership; just keep the counts current and mark it ready
        const query : Segment.Query = segment.data.query;
        if( !query || query.conditions.length === 0 ) { await this.recountSegment( accountId, segmentId ); await this.setSegmentStatus( accountId, segmentId, Segment.Status.ACTIVE ); return; }

        // mark it PROCESSING for the duration of the job
        await this.setSegmentStatus( accountId, segmentId, Segment.Status.PROCESSING );

        // evaluate the filter; on failure, record a failed run + FAILED status
        const evaluated : Type.Result<ContactService.Evaluation> = await this.evaluateQuery( accountId, query );
        if( !evaluated.ok )
        {
            this.log.warn( "segment-materialize: eval failed", { segmentId, error: evaluated.error } );
            await this.setSegmentStatus( accountId, segmentId, Segment.Status.FAILED );
            await this.writeRun( accountId, segmentId, { trigger, by: actorUserId, status: Segment.RunStatus.FAILED, matched: 0, added: 0, removed: 0, total: segment.data.size ?? 0, error: "evaluation failed" } );
            return;
        }

        // apply the segment's sort + top-N limit to pick the matched set
        const ordered : Array<Contact.Entity> = segment.data.sort ? SegmentMatch.orderBy( evaluated.data.matches, segment.data.sort, evaluated.data.context ) : evaluated.data.matches;
        const limited : Array<Contact.Entity> = segment.data.sort && segment.data.limit && segment.data.limit > 0 ? ordered.slice( 0, segment.data.limit ) : ordered;
        const matchIds : Set<string> = new Set<string>( limited.map( ( contact : Contact.Entity ) : string => contact.id ) );

        // classify the existing rows: pinned-in (MANUAL), pinned-out (EXCLUDED), and the reconcilable QUERY rows
        const members : Type.Result<Array<Segment.Member>> = await this.dynamo.query<Segment.Member>( "segment_members", {
            KeyConditionExpression:    "segmentKey = :sk",
            ExpressionAttributeValues: { ":sk": `${ accountId }#${ segmentId }` },
        } );
        const rows : Array<Segment.Member> = members.ok ? members.data : [];
        const pinnedIn : Set<string> = new Set<string>( rows.filter( ( row : Segment.Member ) : boolean => row.source === Segment.MembershipSource.MANUAL ).map( ( row : Segment.Member ) : string => row.contactId ) );
        const pinnedOut : Set<string> = new Set<string>( rows.filter( ( row : Segment.Member ) : boolean => row.source === Segment.MembershipSource.EXCLUDED ).map( ( row : Segment.Member ) : string => row.contactId ) );
        const queryRows : Array<Segment.Member> = rows.filter( ( row : Segment.Member ) : boolean => row.source === Segment.MembershipSource.QUERY );
        const existingQuery : Set<string> = new Set<string>( queryRows.map( ( row : Segment.Member ) : string => row.contactId ) );

        // desired QUERY membership = matches that aren't a user pin (in or out) — pins are honored as-is
        const desiredQuery : Array<string> = Array.from( matchIds ).filter( ( id : string ) : boolean => !pinnedIn.has( id ) && !pinnedOut.has( id ) );
        const desiredSet : Set<string> = new Set<string>( desiredQuery );
        const toAdd : Array<string> = desiredQuery.filter( ( id : string ) : boolean => !existingQuery.has( id ) );
        const toRemove : Array<Segment.Member> = queryRows.filter( ( row : Segment.Member ) : boolean => !desiredSet.has( row.contactId ) );

        // apply the reconciliation (QUERY rows only — MANUAL / EXCLUDED / IMPORT are untouched)
        const now : Type.ISODateTime = new Date().toISOString();
        const additions : Array<Promise<Type.Result<void>>> = toAdd
            .map( ( id : string ) : Promise<Type.Result<void>> => this.dynamo.put( "segment_members", { segmentKey: `${ accountId }#${ segmentId }`, contactKey: `${ accountId }#${ id }`, accountId, segmentId, contactId: id, source: Segment.MembershipSource.QUERY, addedAt: now } ) );
        const removals : Array<Promise<Type.Result<void>>> = toRemove
            .map( ( row : Segment.Member ) : Promise<Type.Result<void>> => this.dynamo.remove( "segment_members", { segmentKey: `${ accountId }#${ segmentId }`, contactId: row.contactId } ) );
        const settled : Array<Type.Result<void>> = await Promise.all( [ ...additions, ...removals ] );
        void settled;   // best-effort; a failed row self-heals on the next materialize

        // effective membership after the run = current non-EXCLUDED rows − removed + added (pins + import kept)
        const membersBefore : number = rows.filter( ( row : Segment.Member ) : boolean => row.source !== Segment.MembershipSource.EXCLUDED ).length;
        const total : number = membersBefore - toRemove.length + toAdd.length;

        // refresh size + per-channel counts, mark ACTIVE, and log the run (when / who / counts)
        await this.recountSegment( accountId, segmentId );
        await this.setSegmentStatus( accountId, segmentId, Segment.Status.ACTIVE );
        await this.writeRun( accountId, segmentId, { trigger, by: actorUserId, status: Segment.RunStatus.COMPLETE, matched: evaluated.data.matches.length, added: toAdd.length, removed: toRemove.length, total } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // append a run record to the segment's history (best-effort — audit, never fails the job)
    private async writeRun( accountId : string, segmentId : string, run : Omit<Segment.Run, "accountId" | "segmentId" | "at"> ) : Promise<void>
    {
        const at : Type.ISODateTime = new Date().toISOString();
        const record : Segment.Run & { segmentKey : string } = { ...run, accountId, segmentId, at, segmentKey: `${ accountId }#${ segmentId }` };
        const wrote : Type.Result<void> = await this.dynamo.put( "segment_runs", { ...record } );
        if( !wrote.ok ) this.log.warn( "segment-run write failed", { segmentId, error: wrote.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // set a segment's lifecycle status (preserving the rest of the row), best-effort
    private async setSegmentStatus( accountId : string, segmentId : string, status : Segment.Status ) : Promise<void>
    {
        const got : Type.Result<Segment.Entity | undefined> = await this.dynamo.get<Segment.Entity>( "segments", { accountId, segmentId } );
        if( !got.ok || !got.data ) return;
        const wrote : Type.Result<void> = await this.dynamo.put( "segments", { ...got.data, segmentId, status } );
        if( !wrote.ok ) this.log.warn( "segment status write failed", { segmentId, status, error: wrote.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // preload membership of the segments referenced by "belongs to segment" rules (for ref evaluation)
    private async loadReferencedMembers( accountId : string, query : Segment.Query ) : Promise<Record<string, Set<string>>>
    {
        const ids : Set<string> = new Set<string>();
        this.collectSegmentRefs( query, ids );
        const members : Record<string, Set<string>> = {};
        for( const segmentId of ids )
        {
            const rows : Type.Result<Array<Segment.Member>> = await this.dynamo.query<Segment.Member>( "segment_members", {
                KeyConditionExpression:    "segmentKey = :sk",
                ExpressionAttributeValues: { ":sk": `${ accountId }#${ segmentId }` },
            } );
            members[ segmentId ] = new Set<string>( rows.ok ? rows.data.map( ( member : Segment.Member ) : string => member.contactId ) : [] );
        }
        return members;
    }

    // recursively gather the segment ids used as operands of "belongs to segment" conditions
    private collectSegmentRefs( group : Segment.Group, into : Set<string> ) : void
    {
        for( const rule of group.conditions )
        {
            if( "op" in rule ) this.collectSegmentRefs( rule, into );
            else if( rule.field === Segment.FieldId.SEGMENT )
                for( const value of rule.values ?? [] ) into.add( String( value ) );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** WORKER: recompute the reachability channelCounts (+ size) of every segment a contact belongs to. */
    public async refreshContactSegments( accountId : string, contactId : string ) : Promise<void>
    {
        // which segments is this contact in? (the inverted membership GSI)
        const members : Type.Result<Array<Segment.Member>> = await this.dynamo.query<Segment.Member>( "segment_members", {
            IndexName:                 "byContact",
            KeyConditionExpression:    "contactKey = :ck",
            ExpressionAttributeValues: { ":ck": `${ accountId }#${ contactId }` },
        } );
        if( !members.ok ) { this.log.warn( "segment-refresh: membership read failed", { contactId, error: members.error } ); return; }

        // recompute each affected segment (sequential — a contact is in a bounded number of segments)
        for( const member of members.data )
            await this.recountSegment( accountId, member.segmentId );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Recompute one segment's size + per-channel reachable-and-opted-in counts from its live members. */
    private async recountSegment( accountId : string, segmentId : string ) : Promise<void>
    {
        const segment : Type.Result<Segment.Entity | undefined> = await this.dynamo.get<Segment.Entity>( "segments", { accountId, segmentId } );
        if( !segment.ok || !segment.data ) return;

        // the segment's members → the contacts. EXCLUDED rows are pinned-out tombstones — NOT members.
        const members : Type.Result<Array<Segment.Member>> = await this.dynamo.query<Segment.Member>( "segment_members", {
            KeyConditionExpression:    "segmentKey = :sk",
            ExpressionAttributeValues: { ":sk": `${ accountId }#${ segmentId }` },
        } );
        if( !members.ok ) return;
        const actual : Array<Segment.Member> = members.data.filter( ( member : Segment.Member ) : boolean => member.source !== Segment.MembershipSource.EXCLUDED );

        // tally per-channel reachable+opted-in across the members
        const counts : Partial<Record<Contact.Channel, number>> = { [ Contact.Channel.EMAIL ]: 0, [ Contact.Channel.SMS ]: 0, [ Contact.Channel.VOICE ]: 0 };
        for( const member of actual )
        {
            const got : Type.Result<Contact.Entity | undefined> = await this.dynamo.get<Contact.Entity>( "contacts", { accountId, contactId: member.contactId } );
            if( !got.ok || !got.data ) continue;
            const contact : Contact.Entity = got.data;
            if( ContactService.reachable( contact, Contact.Channel.EMAIL ) ) counts[ Contact.Channel.EMAIL ] = ( counts[ Contact.Channel.EMAIL ] ?? 0 ) + 1;
            if( ContactService.reachable( contact, Contact.Channel.SMS ) )   counts[ Contact.Channel.SMS ]   = ( counts[ Contact.Channel.SMS ]   ?? 0 ) + 1;
            if( ContactService.reachable( contact, Contact.Channel.VOICE ) ) counts[ Contact.Channel.VOICE ] = ( counts[ Contact.Channel.VOICE ] ?? 0 ) + 1;
        }

        const updated : Segment.Entity = { ...segment.data, segmentId, size: actual.length, channelCounts: counts } as Segment.Entity;
        const wrote : Type.Result<void> = await this.dynamo.put( "segments", { ...updated } );
        if( !wrote.ok ) this.log.warn( "segment-refresh: segment write failed", { segmentId, error: wrote.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Whether a contact is SENDABLE on a channel: has the medium (email/phone) AND isn't opted-out /
     *  suppressed on that channel. (Effective consent = the latest-dated record per channel.) */
    private static reachable( contact : Contact.Entity, channel : Contact.Channel ) : boolean
    {
        const hasMedium : boolean = channel === Contact.Channel.EMAIL
            ? ( contact.emails ?? [] ).some( ( entry : Contact.EmailEntry ) : boolean => entry.value.trim() !== "" )
            : ( contact.phones ?? [] ).some( ( entry : Contact.PhoneEntry ) : boolean => entry.value.trim() !== "" );
        if( !hasMedium ) return false;

        // hard suppression on the channel blocks it outright
        const suppressed : boolean = ( contact.suppression ?? [] ).some( ( record : Contact.SuppressionRecord ) : boolean => record.channel === channel && record.suppressed );
        if( suppressed ) return false;

        // effective consent = the most recent consent record for the channel; opted-out ⇒ not reachable
        const consents : Array<Contact.ConsentRecord> = ( contact.consent ?? [] ).filter( ( record : Contact.ConsentRecord ) : boolean => record.channel === channel );
        if( consents.length === 0 ) return true;   // no explicit consent record → not opted-out
        const latest : Contact.ConsentRecord = consents.reduce( ( best : Contact.ConsentRecord, record : Contact.ConsentRecord ) : Contact.ConsentRecord => record.at > best.at ? record : best );
        return latest.state !== Contact.ConsentState.OPTED_OUT;
    }
}

export namespace ContactService
{
    /** The result of evaluating a segment query: the matches + the eval context + non-evaluable fields. */
    export interface Evaluation
    {
        matches:     Array<Contact.Entity>;
        context:     SegmentMatch.Context;
        unsupported: Array<string>;
    }

    /** contact is single-role: MAIN serves the /contact/* API. */
    export enum Role { MAIN = "main" }

    /** The entity kinds that carry a per-account sequence (the SK of the `contact_counters` table). */
    export enum SequenceKind { CONTACT = "contact", SEGMENT = "segment" }

    /** Default local port per role (also the manifest containerPort — one source, can't drift). */
    export const PORT : Record<Role, number> = { [ Role.MAIN ]: Ports.CONTACT.MAIN };
}

export default ContactService;
