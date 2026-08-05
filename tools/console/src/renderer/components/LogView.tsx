import { useLayoutEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import InputBase from "@mui/material/InputBase";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import SearchIcon from "@mui/icons-material/Search";
import VerticalAlignBottomIcon from "@mui/icons-material/VerticalAlignBottom";
import ClearAllIcon from "@mui/icons-material/ClearAll";

import type { LogLine } from "../../shared/types";
import { MONO } from "../theme";

//
// Shared log viewer: parses our Trace records ({level,time,name,id,message,args}) — optionally wrapped
// in docker-compose's "<container> | …" prefix — and renders them as color-coded columns with an
// expandable JSON payload, falling back to raw text. Used by the service console AND the proxy console
// so both format + filter Trace output identically.
//

export const ANSI = /\[[0-9;]*m/g;
const LEVEL_COLOR = { out: "#c9d1d9", err: "#f85149", sys: "#58a6ff" } as const;

// Tools write lots of *informational* text to stderr (vitest config, npm notices, git hints), so a
// raw line is shown red only when it actually reads like an error — otherwise it uses the normal
// output color. (Trace records keep their own level coloring.)
const ERROR_RE = /(^|\s)(error|errors|fatal|failed|failure|exception|err!|✖|✗|×)(\b|:|!|\s|$)/i;
function rawColor( level : "out" | "err" | "sys", text : string ) : string
{
    if ( level === "sys" ) return LEVEL_COLOR.sys;
    return ERROR_RE.test( text ) ? LEVEL_COLOR.err : LEVEL_COLOR.out;
}

/** The structured levels we filter on (matches Trace's labels). */
export const LEVELS = [ "TRACE", "INFO", "WARN", "ERROR" ] as const;

interface TraceRecord { level : string; time? : string; name? : string; id? : string; message? : string; args? : Array<unknown>; }
interface Parsed { prefix? : string; record? : TraceRecord; raw : string; }

const parseCache = new WeakMap<LogLine, Parsed>();

/** Parse a log line into an optional compose prefix + structured Trace record + raw text, memoized per line. */
export function parseLine( line : LogLine ) : Parsed
{
    const hit : Parsed | undefined = parseCache.get( line );
    if ( hit ) return hit;

    const stripped : string = line.text.replace( ANSI, "" );

    // peel a docker-compose container prefix ("name  | rest"), but only a real name token, and only
    // when the bar comes before any JSON brace (so build-log table rows aren't mis-split)
    let prefix : string | undefined;
    let body : string = stripped;
    const bar : number = stripped.indexOf( "| " );
    const brace : number = stripped.indexOf( "{" );
    if ( bar > 0 && ( brace === -1 || bar < brace ) )
    {
        const candidate : string = stripped.slice( 0, bar ).trim();
        if ( /^[\w.-]+$/.test( candidate ) ) { prefix = candidate; body = stripped.slice( bar + 2 ); }
    }

    let record : TraceRecord | undefined;
    const trimmedBody : string = body.trim();
    if ( trimmedBody.startsWith( "{" ) && trimmedBody.endsWith( "}" ) )
    {
        try
        {
            const obj : Record<string, unknown> = JSON.parse( trimmedBody ) as Record<string, unknown>;
            if ( obj && typeof obj.level === "string" && "message" in obj ) record = obj as unknown as TraceRecord;
        }
        catch { /* not a Trace record — leave as raw */ }
    }

    const parsed : Parsed = { prefix, record, raw: stripped };
    parseCache.set( line, parsed );
    return parsed;
}

/** ISO "…T12:34:56.789Z" → "12:34:56.789". */
function fmtTime( iso? : string ) : string
{
    if ( !iso ) return "";
    const m : RegExpMatchArray | null = iso.match( /T(\d{2}:\d{2}:\d{2}\.\d{3})/ );
    return m ? m[ 1 ] : iso;
}

/** Map a Trace level string to its display color (errors red, warnings amber, info green, …). */
export function recLevelColor( level : string ) : string
{
    switch ( level.toUpperCase() )
    {
        case "ERROR": case "FATAL":   return "#f85149";
        case "WARN":  case "WARNING": return "#d29922";
        case "INFO":                  return "#3fb950";
        case "DEBUG": case "TRACE":   return "#8b949e";
        default:                       return "#58a6ff";
    }
}

// One rendered log line: a structured Trace record (columns + color + expandable JSON) or raw text.
// `hideId` drops the service uid column (e.g. the proxy console — a single instance has no useful uid).
export function LogRow( { line, hideId } : { line : LogLine; hideId? : boolean } )
{
    const [ open, setOpen ] = useState<boolean>( false );
    const parsed : Parsed = parseLine( line );

    // no structured record → render the raw text, error-colored only when it reads like an error
    if ( !parsed.record )
        return (
            <Box component="pre" sx={{ m: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", color: rawColor( line.level, parsed.raw ) }}>
                {parsed.raw}
            </Box>
        );

    const rec : TraceRecord = parsed.record;
    const color : string = recLevelColor( rec.level );
    const data : unknown = Array.isArray( rec.args ) ? ( rec.args.length === 1 ? rec.args[ 0 ] : rec.args ) : rec.args;
    const hasData : boolean = data !== undefined && !( Array.isArray( data ) && data.length === 0 );

    return (
        <Box
            onClick={() => { if ( hasData ) setOpen( ( o ) => !o ); }}
            sx={{ py: 0.15, borderRadius: 0.5, cursor: hasData ? "pointer" : "default", "&:hover": hasData ? { bgcolor: "rgba(255,255,255,0.03)" } : undefined }}
        >
            <Box sx={{ display: "flex", gap: 1, alignItems: "baseline", flexWrap: "wrap" }}>
                <Box component="span" sx={{ color: "#6e7681" }}>{fmtTime( rec.time )}</Box>
                <Box component="span" sx={{ color, fontWeight: 700, minWidth: 40 }}>{rec.level.toUpperCase()}</Box>
                {rec.name && <Box component="span" sx={{ color: "#79c0ff" }}>{rec.name}</Box>}
                {!hideId && rec.id && <Box component="span" sx={{ color: "#6e7681" }}>{rec.id}</Box>}
                <Box component="span" sx={{ color: "#e6edf3" }}>{rec.message}</Box>
                {hasData && !open && (
                    <Box component="span" sx={{ color: "#8b949e", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {JSON.stringify( data )}
                    </Box>
                )}
            </Box>
            {hasData && open && (
                <Box component="pre" sx={{ m: 0, mt: 0.25, ml: 2, color: "#8b949e", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {JSON.stringify( data, null, 2 )}
                </Box>
            )}
        </Box>
    );
}

//
// A self-contained log pane: text filter + level filter (shown when structured records are present) +
// autoscroll, over the formatted rows. Hand it a growing `lines` array; it handles the rest.
//
export function LogView( { lines, empty = "no output", hideId, onClear } : { lines : Array<LogLine>; empty? : string; hideId? : boolean; onClear? : () => void } )
{
    const [ filter, setFilter ]           = useState<string>( "" );
    const [ levelFilter, setLevelFilter ] = useState<Array<string>>( [] );
    const [ autoscroll, setAuto ]         = useState<boolean>( true );
    const endRef = useRef<HTMLDivElement | null>( null );

    const hasRecords : boolean = useMemo<boolean>( () => lines.some( ( line ) => parseLine( line ).record !== undefined ), [ lines ] );

    const shown : Array<LogLine> = useMemo<Array<LogLine>>( () =>
    {
        let out : Array<LogLine> = lines;
        // level filter only applies to structured Trace records; raw lines always pass
        if ( levelFilter.length > 0 )
            out = out.filter( ( line ) => { const record = parseLine( line ).record; return !record || levelFilter.includes( record.level.toUpperCase() ); } );
        if ( filter )
            out = out.filter( ( line ) => line.text.toLowerCase().includes( filter.toLowerCase() ) );
        return out;
    }, [ lines, filter, levelFilter ] );

    useLayoutEffect( () => { if ( autoscroll ) endRef.current?.scrollIntoView( { block: "end" } ); }, [ shown, autoscroll ] );

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            {/* toolbar */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1, py: 0.5, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, bgcolor: "background.default", borderRadius: 1.5, border: "1px solid", borderColor: "divider" }}>
                    <SearchIcon fontSize="small" sx={{ color: "text.disabled" }} />
                    <InputBase placeholder="filter…" value={filter} onChange={( e ) => setFilter( e.target.value )} sx={{ fontSize: 12, width: 130, fontFamily: MONO }} />
                </Box>
                {hasRecords && (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Typography variant="caption" sx={{ color: "text.disabled" }}>level</Typography>
                        <ToggleButtonGroup size="small" value={levelFilter} onChange={( _e, next : Array<string> ) => setLevelFilter( next )}>
                            {LEVELS.map( ( level ) => (
                                <ToggleButton key={level} value={level} sx={{ px: 1.25, py: 0.2, fontFamily: MONO, fontSize: 11, color: recLevelColor( level ), "&.Mui-selected": { color: recLevelColor( level ), fontWeight: 700 } }}>
                                    {level}
                                </ToggleButton>
                            ) )}
                        </ToggleButtonGroup>
                    </Box>
                )}
                <Box sx={{ flexGrow: 1 }} />
                <Tooltip title="Autoscroll to newest">
                    <ToggleButton value="auto" size="small" selected={autoscroll} onChange={() => setAuto( ( v ) => !v )} sx={{ p: 0.6 }}>
                        <VerticalAlignBottomIcon fontSize="small" />
                    </ToggleButton>
                </Tooltip>
                {onClear && <Tooltip title="Clear the log"><IconButton size="small" onClick={onClear}><ClearAllIcon fontSize="small" /></IconButton></Tooltip>}
            </Box>

            {/* body */}
            <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto", bgcolor: "#0a0d12", fontFamily: MONO, fontSize: 12, lineHeight: 1.5, p: 1,
                       "&::-webkit-scrollbar": { width: 10 }, "&::-webkit-scrollbar-thumb": { background: "#30363d", borderRadius: 5 } }}>
                {shown.length === 0
                    ? <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO }}>{filter || levelFilter.length > 0 ? "no lines match the filter" : empty}</Typography>
                    : shown.map( ( line ) => <LogRow key={`${line.stream}-${line.seq}`} line={line} hideId={hideId} /> )}
                <div ref={endRef} />
            </Box>
        </Box>
    );
}
