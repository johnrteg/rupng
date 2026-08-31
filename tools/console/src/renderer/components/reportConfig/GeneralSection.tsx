import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

//
// GeneralSection — the report service's one operational tunable today: the environment-max artifact
// retention (S3 lifecycle expiry, by object age). A per-account override is explicitly deferred (see
// ReportConfig's header comment) — this is the environment ceiling, not a per-account setting.
//

/** The retention-days control for the report service's `settings` config. */
export function GeneralSection( props : GeneralSection.Props )
{
    return (
        <ConfigSection title="General" hint="Environment-max artifact retention — S3 lifecycle expiry by object age. A per-account override (<= this max) is not yet supported.">
            <RangeNumberField
                label="Retention (days)"
                help="Artifacts older than this are expired from storage. Artifacts are regenerable, so a conservative default is safer than accumulating exports indefinitely."
                value={props.retentionDays}
                onChange={props.onChangeRetentionDays}
                min={1} max={3650}
                disabled={props.readOnly}
            />
        </ConfigSection>
    );
}

export namespace GeneralSection
{
    export interface Props
    {
        retentionDays           : number;
        onChangeRetentionDays   : ( value : number ) => void;
        readOnly                : boolean;
    }
}

export default GeneralSection;
