import { MediaConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Download archive retention — how long a generated zip stays before its S3 bytes + record are swept. */
export function DownloadsSection( props : DownloadsSection.Props )
{
    return (
        <ConfigSection title="Downloads" hint="Retention for generated download archives (zips).">
            <RangeNumberField
                label="TTL (days)" help="Days before a generated zip is swept."
                value={props.value.ttlDays} min={1} disabled={props.readOnly}
                onChange={( ttlDays : number ) : void => props.onChange( { ...props.value, ttlDays } )}
            />
        </ConfigSection>
    );
}

export namespace DownloadsSection
{
    export interface Props
    {
        value    : MediaConfig.Downloads;
        onChange : ( value : MediaConfig.Downloads ) => void;
        readOnly : boolean;
    }
}

export default DownloadsSection;
