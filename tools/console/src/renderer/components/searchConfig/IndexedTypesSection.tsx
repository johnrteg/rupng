import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import { Search } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";

/** Which entity kinds the search index carries (search-4.2) — a doc type not checked here is neither
 *  ingested from its owning service's events nor queryable, even if that service still publishes it. */
export function IndexedTypesSection( props : IndexedTypesSection.Props )
{
    /** Toggle one doc type on/off in the indexed set, preserving the rest. */
    function onToggle( docType : Search.DocType, checked : boolean ) : void
    {
        const next : Array<Search.DocType> = checked
            ? [ ...props.value, docType ]
            : props.value.filter( ( existing : Search.DocType ) : boolean => existing !== docType );
        props.onChange( next );
    }

    return (
        <ConfigSection title="Indexed types" hint="Which entity kinds are ingested + searchable. Unchecking a type stops new docs of that kind from being indexed — it does not purge already-indexed docs.">
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                {Object.values( Search.DocType ).map( ( docType : Search.DocType ) => (
                    <FormControlLabel
                        key={docType}
                        label={docType}
                        control={
                            <Checkbox
                                checked={props.value.includes( docType )} disabled={props.readOnly}
                                onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => onToggle( docType, event.target.checked )}
                            />
                        }
                    />
                ) )}
            </Box>
        </ConfigSection>
    );
}

export namespace IndexedTypesSection
{
    export interface Props
    {
        value    : Array<Search.DocType>;
        onChange : ( value : Array<Search.DocType> ) => void;
        readOnly : boolean;
    }
}

export default IndexedTypesSection;
