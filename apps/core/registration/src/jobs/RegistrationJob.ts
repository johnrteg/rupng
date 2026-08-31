//
import { Application, Job, Register, Dynamo, Sqs, Kafka, Secrets } from "@repo/services";

import { RegistrationDomain } from "../domain/RegistrationDomain";

//
// RegistrationJob — the domain base every concrete registration Lambda extends (registration-12.1/12.4),
// mirroring `RegistrationService` on the HTTP side. It declares the SAME four facades and builds the SAME
// {@link RegistrationDomain} from them.
//
// Note what it deliberately does NOT do: re-implement any registration logic. `MarketplaceJob` mirrors
// `MarketplaceService`'s facades and then each side reaches for separate pipeline modules; registration goes
// one step further and puts the whole domain behind one object, so the state machine a Lambda drives is
// literally the same code the API drives. This base is only the Lambda-side host for it.
//
export abstract class RegistrationJob<TEvent = unknown, TResult = void> extends Job<TEvent, TResult>
{
    protected pkg : Application.PackageInfo;

    private _dynamo?  : Dynamo;
    private _sqs?     : Sqs;
    private _kafka?   : Kafka;
    private _secrets? : Secrets;
    private _domain?  : RegistrationDomain;

    ///////////////////////////////////////////////////////////////////////////////////////
    constructor( name : string )
    {
        super( Register.Service.REGISTRATION, name );
        this.pkg = this.loadPackageInfo( __dirname );
        this.log.info( "version", { name: this.pkg.name, version: this.pkg.version } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** DynamoDB facade — the registration projection. Lazy + cached across warm invocations. */
    protected get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }
    /** SQS facade — this job may itself enqueue follow-on work (e.g. webhook → provisioning). Lazy + cached. */
    protected get sqs() : Sqs { return this._sqs ??= new Sqs( this.cloud ); }
    /** Kafka facade — the published status + trust-score → MPS. Lazy + cached. */
    protected get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }
    /** Secrets facade — TCR / Campaign Verify / carrier credentials. Lazy + cached. */
    protected get secrets() : Secrets { return this._secrets ??= new Secrets( this.cloud ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** The shared domain object — the ONE implementation of the state machine, the projection repo, the
     *  provider clients, the status publish and the cost-estimate ledger (registration-12.5). */
    protected get domain() : RegistrationDomain
    {
        return this._domain ??= new RegistrationDomain( {
            dynamo: this.dynamo, sqs: this.sqs, kafka: this.kafka, secrets: this.secrets,
            appConfig: this.appConfig, log: this.log,
        } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Parse the JSON bodies out of an SQS Lambda event's records, paired with the source queue ARN so a job
     *  fed by MORE THAN ONE queue (the webhook worker) can tell the streams apart. A malformed record is
     *  skipped rather than failing the whole batch — one bad message must not redeliver its nine siblings. */
    protected sqsRecords( event : unknown ) : Array<RegistrationJob.SqsRecord>
    {
        const raw : Array<{ body? : string; eventSourceARN? : string }> = ( event as { Records? : Array<{ body? : string; eventSourceARN? : string }> } )?.Records ?? [];
        const records : Array<RegistrationJob.SqsRecord> = [];
        for( const record of raw )
        {
            try
            {
                const parsed : Record<string, unknown> = JSON.parse( record.body ?? "{}" ) as Record<string, unknown>;
                records.push( { body: parsed, sourceArn: record.eventSourceARN ?? "" } );
            }
            catch( error ) { this.log.warn( "skipping a malformed SQS record", { error: String( error ) } ); }
        }
        return records;
    }
}

export namespace RegistrationJob
{
    /** One parsed SQS record — its JSON body plus the queue ARN it arrived on. */
    export interface SqsRecord { body : Record<string, unknown>; sourceArn : string; }
}

export default RegistrationJob;
// eof
