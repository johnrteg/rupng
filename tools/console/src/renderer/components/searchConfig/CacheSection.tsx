import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Result-cache TTL (search-2.2) — how long a query's results are cached in Redis before re-querying. */
export function CacheSection( props : CacheSection.Props )
{
    return (
        <ConfigSection title="Result cache" hint="How long a query's results are cached before the next matching query re-runs against the index.">
            <RangeNumberField
                label="Cache TTL (seconds)" value={props.value} min={0} disabled={props.readOnly}
                onChange={props.onChange}
            />
        </ConfigSection>
    );
}

export namespace CacheSection
{
    export interface Props
    {
        value    : number;
        onChange : ( value : number ) => void;
        readOnly : boolean;
    }
}

export default CacheSection;
