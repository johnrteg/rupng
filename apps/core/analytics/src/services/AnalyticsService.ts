//
import { Application, Service, Ports, Register, Dynamo, S3, Kafka, Sqs } from "@repo/services";
import { Analytics } from "@repo/api";
import { ResultUtils, type Type } from "@repo/common";

//
// AnalyticsService — the domain base every concrete analytics role extends (mirrors AuditService /
// PrintService). Holds the shared domain wiring (Dynamo + S3 + Kafka facades) so the concrete role
// inherits it. NOT deployed alone. Analytics is shaped unusually per SPECS.md "Service & Job
// topology": the HTTP surface is a single thin Query API (`AnalyticsQueryService`); nearly all the
// work happens in `AnalyticsIngestConsumer`/`AnalyticsRollupConsumer` (ECS `Consumer` roles, not
// this Service hierarchy — see `AnalyticsConsumer.ts`).
//
export class AnalyticsService extends Service
{
    private _dynamo? : Dynamo;
    private _s3?     : S3;
    private _kafka?  : Kafka;
    private _sqs?    : Sqs;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( role : AnalyticsService.Role )
    {
        super( Register.Service.ANALYTICS, role, AnalyticsService.PORT[ role ] );
        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** DynamoDB facade — the rollups table (query reads) + the ingest dedup table. */
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }
    /** S3 facade — the raw event lake (`S3.Domain.EVENTS`). */
    public get s3() : S3 { return this._s3 ??= new S3( this.cloud ); }
    /** Kafka facade — `Events.Stream.ENGAGEMENT` / `BEHAVIOR` (consumers subscribe; the query role
     *  doesn't publish/subscribe today but shares the getter for consistency). */
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }
    /** SQS facade — the `analytics-backfill` request queue (`PostAnalyticsReprocess` enqueues here). */
    public get sqs() : Sqs { return this._sqs ??= new Sqs( this.cloud ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Read rollup rows for `accountId` (tenant-scoped — analytics-5.3), optionally narrowed by
     * `filters`. Pushes `channel` down into a `begins_with` on the sort key (the rollup key's first
     * segment — AnalyticsRollupConsumer.sortKey); everything else is filtered in-memory against the
     * account's (bounded) rollup set. Revisit with a proper GSI if a single account's rollup volume
     * ever makes the unfiltered case too wide — same MVP tradeoff as contact's identifier lookup.
     */
    public async queryRollups( accountId : string, filters : AnalyticsService.RollupFilters = {} ) : Promise<Type.Result<Array<Analytics.Rollup>>>
    {
        const prefix : string | undefined = filters.channel ? `channel#${ filters.channel }#` : undefined;
        const found : Type.Result<Array<Record<string, unknown>>> = await this.dynamo.query<Record<string, unknown>>( "rollups", prefix
            ? { KeyConditionExpression: "accountId = :a AND begins_with( sk, :prefix )", ExpressionAttributeValues: { ":a": accountId, ":prefix": prefix } }
            : { KeyConditionExpression: "accountId = :a", ExpressionAttributeValues: { ":a": accountId } } );
        if( !found.ok ) return found;

        const rows : Array<Analytics.Rollup> = found.data
            .map( ( row : Record<string, unknown> ) : Analytics.Rollup => ( {
                dimensions:  {
                    accountId, channel: row.channel as Analytics.Channel | undefined,
                    campaignId: ( row.campaignId as string | null ) ?? undefined,
                    eventType:  row.eventType as Analytics.EventVerb | undefined,
                    provider:   ( row.provider as Analytics.Provider | null ) ?? undefined,
                },
                granularity: row.granularity as Analytics.Granularity,
                periodStart: row.periodStart as Type.ISODateTime,
                count:       Number( row.count ?? 0 ),
                closed:      Boolean( row.closed ),
                computedAt:  row.computedAt as Type.ISODateTime,
            } ) )
            .filter( ( row : Analytics.Rollup ) : boolean => !filters.campaignId  || row.dimensions.campaignId === filters.campaignId )
            .filter( ( row : Analytics.Rollup ) : boolean => !filters.eventType   || row.dimensions.eventType  === filters.eventType )
            .filter( ( row : Analytics.Rollup ) : boolean => !filters.provider    || row.dimensions.provider   === filters.provider )
            .filter( ( row : Analytics.Rollup ) : boolean => !filters.granularity || row.granularity           === filters.granularity )
            .filter( ( row : Analytics.Rollup ) : boolean => !filters.from        || row.periodStart >= filters.from! )
            .filter( ( row : Analytics.Rollup ) : boolean => !filters.to          || row.periodStart <= filters.to! );

        return ResultUtils.ok( rows );
    }
}

export namespace AnalyticsService
{
    export enum Role { MAIN = "main" }   // the one HTTP role — AnalyticsQueryService

    export const PORT : Record<Role, number> =
    {
        [ Role.MAIN ] : Ports.ANALYTICS.MAIN,
    };

    /** Optional narrowing for {@link AnalyticsService.queryRollups}. */
    export interface RollupFilters
    {
        channel?:     Analytics.Channel;
        campaignId?:  string;
        eventType?:   Analytics.EventVerb;
        provider?:    Analytics.Provider;
        granularity?: Analytics.Granularity;
        from?:        Type.ISODateTime;   // inclusive — compared against periodStart
        to?:          Type.ISODateTime;   // inclusive — compared against periodStart
    }
}

export default AnalyticsService;
// eof
