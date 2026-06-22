//
// EventBridge Scheduler facade — create/manage DYNAMIC schedules (cron/rate/one-time) at
// runtime, delivering to a queue or function the service owns.
//
import {
    SchedulerClient,
    CreateScheduleCommand, UpdateScheduleCommand, GetScheduleCommand,
    ListSchedulesCommand, DeleteScheduleCommand,
} from "@aws-sdk/client-scheduler";
import type {
    GetScheduleCommandOutput, ListSchedulesCommandOutput, ScheduleSummary,
    Target as SchedulerTarget, FlexibleTimeWindow,
} from "@aws-sdk/client-scheduler";
import type { CloudResolver, ResourceKey } from "@repo/cloud-manifest";
import { ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";
import { ClientUtils } from "./ClientUtils";

/**
 * EventBridge Scheduler facade — manage **dynamic** schedules (created/edited at RUNTIME) that
 * fire a recurring or one-time event into a queue or function this service owns.
 *
 * **Use for** application-driven schedules whose set isn't known at deploy time — "remind this
 * account every 30 minutes", "run this report on the first Monday of the month", "fire once at
 * 2026-07-01T09:00Z". For a fixed, deploy-time schedule baked into infra, use an EventBridge
 * rule instead.
 *
 * Requires the owning service to declare `owns.scheduler` in its manifest — the /cloud build
 * then provisions a per-service **schedule group** + an **execution role** Scheduler assumes to
 * deliver, and injects `SCHEDULER_GROUP` / `SCHEDULER_ROLE_ARN`. Targets are addressed by their
 * cloud-manifest LOGICAL keys ({@link Scheduler.Target}); reach `.client` for the raw SDK.
 */
export class Scheduler
{
    private _client? : SchedulerClient;

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * @param cloud   the owning service's resolver — maps logical target keys to physical ARNs.
     * @param group   the schedule group (IAM/listing scope). Defaults to `SCHEDULER_GROUP`.
     * @param roleArn the execution role Scheduler assumes to deliver. Defaults to `SCHEDULER_ROLE_ARN`.
     */
    constructor(
        private readonly cloud   : CloudResolver,
        private readonly group   : string = process.env.SCHEDULER_GROUP ?? "default",
        private readonly roleArn : string = process.env.SCHEDULER_ROLE_ARN ?? "",
    ) {}

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** The raw `SchedulerClient` — escape hatch (tagging, dead-letter config, KMS). Lazy + cached. */
    get client() : SchedulerClient { return this._client ??= ClientUtils.createClient( SchedulerClient ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Create the schedule, or update it in place if a schedule of that name already exists
     * (idempotent upsert). Exactly one of `every` / `cron` / `at` must be set.
     *
     * @param name unique schedule name within this service's group (e.g. `"acct-42-digest"`).
     * @param opts cadence + target + payload — see {@link Scheduler.Options}.
     */
    async upsert( name : string, opts : Scheduler.Options ) : Promise<Type.Result<void>>
    {
        // Pure validation up front (no throw) — only the SDK calls go through ResultUtils.from.
        const expression : Type.Result<string> = this.expression( opts );
        if( !expression.ok ) return expression;
        if( opts.target.queueKey === undefined && opts.target.functionKey === undefined )
            return ResultUtils.err( "Scheduler.upsert: target needs a queueKey or functionKey" );

        return ResultUtils.from( async () : Promise<void> =>
        {
            const input : {
                Name : string; GroupName : string; ScheduleExpression : string;
                ScheduleExpressionTimezone? : string; State : "ENABLED" | "DISABLED";
                Target : SchedulerTarget; FlexibleTimeWindow : FlexibleTimeWindow;
            } = {
                Name                       : name,
                GroupName                  : this.group,
                ScheduleExpression         : expression.data,
                ScheduleExpressionTimezone : opts.timezone,
                State                      : ( opts.enabled ?? true ) ? "ENABLED" : "DISABLED",
                Target                     : this.target( opts.target, opts.input ),
                FlexibleTimeWindow         : { Mode: "OFF" },
            };

            try
            {
                await this.client.send( new CreateScheduleCommand( input ) );
            }
            catch( err : unknown )
            {
                if( ( err as { name? : string } ).name !== "ConflictException" ) throw err;
                await this.client.send( new UpdateScheduleCommand( input ) );
            }
        } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Fetch one schedule's full definition (cadence, target, state). */
    get( name : string ) : Promise<Type.Result<GetScheduleCommandOutput>>
    {
        return ResultUtils.from( () => this.client.send( new GetScheduleCommand( { Name: name, GroupName: this.group } ) ) );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * List schedules in this service's group, optionally filtered by name prefix. Returns
     * lightweight summaries — call {@link get} for a single schedule's full definition.
     */
    list( namePrefix? : string ) : Promise<Type.Result<Array<ScheduleSummary>>>
    {
        return ResultUtils.from( async () : Promise<Array<ScheduleSummary>> =>
        {
            const result : ListSchedulesCommandOutput = await this.client.send(
                new ListSchedulesCommand( { GroupName: this.group, NamePrefix: namePrefix } ) );
            return result.Schedules ?? [];
        } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Pause a schedule (stop firing) without deleting it — reversible via {@link resume}. */
    pause( name : string ) : Promise<Type.Result<void>> { return this.setState( name, "DISABLED" ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Resume a previously {@link pause}d schedule. */
    resume( name : string ) : Promise<Type.Result<void>> { return this.setState( name, "ENABLED" ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Delete a schedule permanently. */
    remove( name : string ) : Promise<Type.Result<void>>
    {
        return ResultUtils.from( async () : Promise<void> =>
        {
            await this.client.send( new DeleteScheduleCommand( { Name: name, GroupName: this.group } ) );
        } );
    }

    //////////////////////////////////////////////////////////////////////////////
    // internals

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Flip a schedule's State, preserving its existing cadence + target (get-then-update). */
    private setState( name : string, state : "ENABLED" | "DISABLED" ) : Promise<Type.Result<void>>
    {
        return ResultUtils.from( async () : Promise<void> =>
        {
            const cur : GetScheduleCommandOutput = await this.client.send( new GetScheduleCommand( { Name: name, GroupName: this.group } ) );
            await this.client.send( new UpdateScheduleCommand( {
                Name                       : name,
                GroupName                  : this.group,
                ScheduleExpression         : cur.ScheduleExpression,
                ScheduleExpressionTimezone : cur.ScheduleExpressionTimezone,
                State                      : state,
                Target                     : cur.Target,
                FlexibleTimeWindow         : cur.FlexibleTimeWindow ?? { Mode: "OFF" },
            } ) );
        } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Build the `rate(...)` / `cron(...)` / `at(...)` ScheduleExpression — {@link Type.Result}, no throw. */
    private expression( opts : Scheduler.Options ) : Type.Result<string>
    {
        if( opts.every ) return ResultUtils.ok( `rate(${opts.every})` );
        if( opts.cron )  return ResultUtils.ok( `cron(${opts.cron})` );
        if( opts.at )    return ResultUtils.ok( `at(${opts.at})` );
        return ResultUtils.err( "Scheduler.upsert: exactly one of `every`, `cron`, or `at` is required" );
    }

    /**
     * Resolve a logical target key to a Scheduler {@link SchedulerTarget} (ARN + role + payload).
     * Presence of `queueKey`/`functionKey` is validated by {@link upsert} before this runs; the only
     * throws here are CloudResolver lookups, which run inside {@link upsert}'s `ResultUtils.from`.
     */
    private target( target : Scheduler.Target, payload? : object ) : SchedulerTarget
    {
        const arn : string = target.functionKey !== undefined
            ? this.cloud.functionArn( target.functionKey )
            : this.queueArn( this.cloud.queueUrl( target.queueKey as ResourceKey ) );

        return {
            Arn     : arn,
            RoleArn : this.roleArn,
            Input   : payload !== undefined ? JSON.stringify( payload ) : undefined,
        };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Derive an SQS queue ARN from its URL. Queue URLs are
     * `https://sqs.<region>.amazonaws.com/<account>/<name>` (LocalStack uses a host:port prefix);
     * the last two path segments are always `<account>/<name>`. Region comes from the `sqs.<region>`
     * host label, falling back to `AWS_REGION`.
     */
    private queueArn( url : string ) : string
    {
        const parsed : URL = new URL( url );
        const parts : Array<string> = parsed.pathname.split( "/" ).filter( Boolean );
        const account : string = parts[ parts.length - 2 ] ?? "";
        const name    : string = parts[ parts.length - 1 ] ?? "";
        const hostMatch : RegExpMatchArray | null = parsed.hostname.match( /^sqs\.([^.]+)\./ );
        const region : string = hostMatch?.[ 1 ] ?? process.env.AWS_REGION ?? "us-east-1";
        return `arn:aws:sqs:${region}:${account}:${name}`;
    }
}

export namespace Scheduler
{
    /** Where a schedule delivers — exactly one of `queueKey` / `functionKey`, by cloud-manifest logical key. */
    export interface Target
    {
        queueKey?    : ResourceKey;     // deliver to an owned SQS queue
        functionKey? : ResourceKey;     // invoke an owned Lambda function
    }

    /** Cadence + target + payload for {@link Scheduler.upsert}. Set exactly one of `every`/`cron`/`at`. */
    export interface Options
    {
        every?    : string;             // rate, e.g. "30 minutes", "1 day"  -> rate(...)
        cron?     : string;             // cron body, e.g. "0 12 ? * 2#1 *" (first Mon)  -> cron(...)
        at?       : string;             // one-time ISO timestamp, e.g. "2026-07-01T09:00:00"  -> at(...)
        timezone? : string;             // IANA tz for cron/at (e.g. "America/New_York"); default UTC
        target    : Target;             // where it fires
        input?    : object;             // JSON payload delivered to the target
        enabled?  : boolean;            // start paused with false (default true)
    }
}
