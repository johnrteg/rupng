import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { Search, SearchConfig, LogLevel } from "@repo/api";
import { SearchConfigFormModel } from "./SearchConfigFormModel";
import { IndexedTypesSection } from "./IndexedTypesSection";
import { WeightsSection } from "./WeightsSection";
import { AuditSection } from "./AuditSection";
import { CacheSection } from "./CacheSection";
import { LoggingSection } from "../configEditor/LoggingSection";

//
// SearchConfigForm — the "smart" alternative to the raw JSON editor for the search service's `settings`
// config. Mirrors voiceConfig/VoiceConfigForm.tsx: one section per SearchConfig.Config concern — which doc
// types are indexed, their per-type relevance weights, the query-audit posture, and the result-cache TTL.
// Reads/writes the SAME JSON text the JSON editor shows.
//
// IMPORTANT: any new field added to SearchConfig.Config (packages/api/src/search/model/SearchConfig.ts)
// needs a matching control added here — see CLAUDE.md's "Models & closed sets" note.
//

/** The smart, form-based editor for the search service's `settings` AppConfig profile. */
export function SearchConfigForm( props : SearchConfigForm.Props )
{
    const config : SearchConfig.Config | null = SearchConfigFormModel.parse( props.content );

    if ( !config )
        return (
            <Box sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: "error.main" }}>
                    Current content isn't valid JSON — switch to the JSON editor to fix it before using the smart editor.
                </Typography>
            </Box>
        );

    /** Commit an updated section back into the full config, re-serialize, and notify ConfigPanel. */
    function update<Key extends keyof SearchConfig.Config>( key : Key, value : SearchConfig.Config[ Key ] ) : void
    {
        const next : SearchConfig.Config = { ...( config as SearchConfig.Config ), [ key ]: value };
        props.onChange( SearchConfigFormModel.stringify( next ) );
    }

    return (
        <Box sx={{ p: 1.5, overflowY: "auto", height: "100%" }}>
            <IndexedTypesSection value={config.indexedTypes} readOnly={props.readOnly} onChange={( value : Array<Search.DocType> ) : void => update( "indexedTypes", value )} />
            <WeightsSection value={config.weights} readOnly={props.readOnly} onChange={( value : Record<Search.DocType, SearchConfig.TypeWeights> ) : void => update( "weights", value )} />
            <AuditSection value={config.audit} readOnly={props.readOnly} onChange={( value : SearchConfig.AuditConfig ) : void => update( "audit", value )} />
            <CacheSection value={config.cacheTtlSeconds} readOnly={props.readOnly} onChange={( value : number ) : void => update( "cacheTtlSeconds", value )} />
            <LoggingSection value={config.logLevel ?? LogLevel.INFO} readOnly={props.readOnly} onChange={( value : LogLevel ) : void => update( "logLevel", value )} />
        </Box>
    );
}

export namespace SearchConfigForm
{
    export interface Props
    {
        content  : string;
        onChange : ( content : string ) => void;
        readOnly : boolean;
    }
}

export default SearchConfigForm;
