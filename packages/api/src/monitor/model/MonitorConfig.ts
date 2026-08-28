//
// MonitorConfig — the monitor service's runtime configuration (its AppConfig `config/settings`
// profile): the list of dashboard WIDGETS an operator has configured, each pointing at one
// physical AWS resource (a table, a queue, an ECS service, a Lambda function, or an API target)
// to poll. Lives in @repo/api (one definition) so the service reads it live + seeds `DEFAULT`,
// the Console's AppConfig editor lints against `SCHEMA`, and its smart editor validates.
//
// v1 is deliberately manual — a widget's `target` is a physical identifier the operator supplies
// (table name / queue URL / ECS service name / Lambda function name / ALB target-group ARN
// suffix), not auto-discovered from other services' CloudManifests (a later phase).
//
import { Validation } from "../../model/Validation";
import { LogLevel } from "../../model/LogLevel";

export namespace MonitorConfig
{
    /** What a widget polls — decides which facade + physical identifier shape `target` is. */
    export enum WidgetType
    {
        DYNAMO_TABLE = "dynamoTable",   // target = physical DynamoDB table name
        SQS_QUEUE    = "sqsQueue",      // target = SQS queue URL
        ECS_SERVICE  = "ecsService",    // target = "<cluster>/<serviceName>"
        LAMBDA_JOB   = "lambdaJob",     // target = Lambda function name
        API_TARGET   = "apiTarget",     // target = ALB target-group name (CloudWatch dimension value)
    }

    /** Warn/critical thresholds for a widget's primary value — the dashboard tile's status color. */
    export interface Thresholds { warn? : number; critical? : number; }

    /** One configured dashboard widget. */
    export interface WidgetConfig
    {
        id                 : string;
        type               : WidgetType;
        label              : string;
        target             : string;
        region?            : string;
        refreshIntervalSec : number;
        thresholds?        : Thresholds;
    }

    export interface Config
    {
        widgets   : Array<WidgetConfig>;
        logLevel? : LogLevel;   // minimum log verbosity — applied live, no redeploy (Application.refreshLogLevel)
    }

    // ── Schema + validator (shared: service / web / Console) ────────────────────────────────────
    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "widgets" ],
        properties:
        {
            widgets: {
                type: "array",
                items: {
                    type: "object", additionalProperties: false,
                    required: [ "id", "type", "label", "target", "refreshIntervalSec" ],
                    properties: {
                        id:                 { type: "string", minLength: 1 },
                        type:               { type: "string", enum: Object.values( WidgetType ) },
                        label:              { type: "string", minLength: 1 },
                        target:             { type: "string", minLength: 1 },
                        region:             { type: "string" },
                        refreshIntervalSec: { type: "number", minimum: 5 },
                        thresholds: {
                            type: "object", additionalProperties: false,
                            properties: { warn: { type: "number" }, critical: { type: "number" } },
                        },
                    },
                },
            },
            logLevel: { type: "string", enum: Object.values( LogLevel ) },
        },
    };

    /** JSON Schema validator for `Config`. */
    export const validate : Validation.Validator<Config> = Validation.compile<Config>( SCHEMA );

    // ── Seeded defaults (the DEFAULT the service seeds + falls back to) ──────────────────────────
    export const DEFAULT : Config =
    {
        widgets:  [],
        logLevel: LogLevel.INFO,
    };
}

export default MonitorConfig;
// eof
