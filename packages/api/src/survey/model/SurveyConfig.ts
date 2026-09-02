//
import { Validation } from "../../model/Validation";
import { LogLevel } from "../../model/LogLevel";

//
// SurveyConfig — account-level operational defaults for the survey service (AppConfig profile "settings"),
// smart-editable in Console per CLAUDE.md's config-model convention (registered in ConfigSchema.ts). Not a
// DynamoDB entity — read via AppConfig and merged with ObjectUtils.withDefaults( row, SurveyConfig.DEFAULT ).
//
export namespace SurveyConfig
{
    export interface Config
    {
        /** The account-wide default for `Distribution.anonymous` when a distribution doesn't specify one
         *  (survey-4.4). */
        anonymousDefault: boolean;

        /** Minutes an `in_progress` Response may sit idle before the abandonment sweep flips it to
         *  `abandoned` (survey-4.3). */
        abandonmentTimeoutMinutes: number;

        /** Days a partial (`in_progress` / `abandoned`) Response is retained before its DynamoDB TTL ages
         *  it out (survey-4.3 retention). */
        partialRetentionDays: number;

        /** Optional dynamic log level override (Application.refreshLogLevel — see CLAUDE.md "Log level is
         *  dynamic"). */
        logLevel? : LogLevel;
    }

    /** Safe baseline — fills an older/partial AppConfig row. */
    export const DEFAULT : Config =
    {
        anonymousDefault:          false,
        abandonmentTimeoutMinutes: 60,
        partialRetentionDays:      30,
    };

    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "anonymousDefault", "abandonmentTimeoutMinutes", "partialRetentionDays" ],
        properties:
        {
            anonymousDefault:          { type: "boolean" },
            abandonmentTimeoutMinutes: { type: "number", minimum: 1 },
            partialRetentionDays:      { type: "number", minimum: 1 },
            logLevel:                  { type: "string", enum: Object.values( LogLevel ) },
        },
    };

    /** Validate a `SurveyConfig.Config` (an AppConfig deployment payload). */
    export const validate : Validation.Validator<Config> = Validation.compile<Config>( SCHEMA );
}

export default SurveyConfig;
// eof
