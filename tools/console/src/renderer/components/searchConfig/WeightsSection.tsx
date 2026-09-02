import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { Search, SearchConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** One doc type's relevance weights — how much a match in `title` counts vs. a match in `text` (search-2.4). */
function WeightRow( props : WeightRow.Props )
{
    /** Patch one field of this doc type's weights, preserving the other. */
    function set( patch : Partial<SearchConfig.TypeWeights> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{props.docType}</Typography>
            <RangeNumberField
                label="Title weight" value={props.value.title} min={0} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { title: value } )}
            />
            <RangeNumberField
                label="Text weight" value={props.value.text} min={0} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { text: value } )}
            />
        </Box>
    );
}

namespace WeightRow
{
    export interface Props
    {
        docType  : Search.DocType;
        value    : SearchConfig.TypeWeights;
        onChange : ( value : SearchConfig.TypeWeights ) => void;
        readOnly : boolean;
    }
}

/** Per-type relevance tuning (search-2.4) — a row of title/text weights for every configured doc type. */
export function WeightsSection( props : WeightsSection.Props )
{
    /** Patch one doc type's weights by key, preserving the rest of the map. */
    function onRowChange( docType : Search.DocType, value : SearchConfig.TypeWeights ) : void
    {
        props.onChange( { ...props.value, [ docType ]: value } );
    }

    return (
        <ConfigSection title="Relevance weights" hint="Per-type field weights — a higher title weight ranks a title match above a body-text match.">
            {Object.values( Search.DocType ).map( ( docType : Search.DocType ) => (
                <WeightRow
                    key={docType} docType={docType} value={props.value[ docType ]} readOnly={props.readOnly}
                    onChange={( value : SearchConfig.TypeWeights ) : void => onRowChange( docType, value )}
                />
            ) )}
        </ConfigSection>
    );
}

export namespace WeightsSection
{
    export interface Props
    {
        value    : Record<Search.DocType, SearchConfig.TypeWeights>;
        onChange : ( value : Record<Search.DocType, SearchConfig.TypeWeights> ) => void;
        readOnly : boolean;
    }
}

export default WeightsSection;
