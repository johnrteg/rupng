import { useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import SaveIcon from "@mui/icons-material/Save";
import RefreshIcon from "@mui/icons-material/Refresh";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";

import type { DynamoKeySchema, DynamoTable, TargetInfo } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";

//
// The Data tab — browse/edit a service's DynamoDB tables. Available to every service; the table
// dropdown is empty when a service owns none. Scan a page of items, click one to edit its JSON, save
// (put) or delete. Real AWS is read-only (same guard as Config).
//
export function DynamoPanel( { service } : { service : string } )
{
    const [ tables, setTables ]   = useState<DynamoTable[]>( [] );
    const [ table, setTable ]     = useState<string>( "" );
    const [ keySchema, setKeySchema ] = useState<DynamoKeySchema | null>( null );
    const [ loadingTables, setLoadingTables ] = useState<boolean>( true );
    const [ treeError, setTreeError ] = useState<string>( "" );

    const [ items, setItems ]     = useState<Array<Record<string, unknown>>>( [] );
    const [ lastKey, setLastKey ] = useState<Record<string, unknown> | undefined>( undefined );
    const [ loading, setLoading ] = useState<boolean>( false );

    const [ draft, setDraft ]     = useState<string>( "" );      // JSON of the selected/new item
    const [ original, setOriginal ] = useState<string>( "" );
    const [ isNew, setIsNew ]     = useState<boolean>( false );
    const [ saving, setSaving ]   = useState<boolean>( false );
    const [ msg, setMsg ]         = useState<{ kind : "ok" | "err"; text : string } | null>( null );

    const [ targetInfo, setTargetInfo ] = useState<TargetInfo | null>( null );
    const readOnly : boolean = targetInfo?.readOnly ?? false;

    useEffect( () => { void api.targetGet().then( setTargetInfo ); }, [] );

    // load the service's tables
    useEffect( () =>
    {
        let active : boolean = true;
        setLoadingTables( true ); setTreeError( "" ); setTables( [] ); setTable( "" );
        setItems( [] ); setDraft( "" ); setOriginal( "" );
        void api.dynamoTables( service ).then( ( r ) =>
        {
            if ( !active ) return;
            setLoadingTables( false );
            if ( r.error ) { setTreeError( r.error ); return; }
            setTables( r.tables );
            if ( r.tables.length > 0 ) setTable( r.tables[ 0 ].name );
        } );
        return () => { active = false; };
    }, [ service ] );

    // on table change: key schema + first scan page
    useEffect( () =>
    {
        if ( !table ) { setKeySchema( null ); setItems( [] ); return; }
        let active : boolean = true;
        clearEditor();
        void api.dynamoTableInfo( table ).then( ( r ) => { if ( active && r.keySchema ) setKeySchema( r.keySchema ); } );
        void scan( undefined, true );
        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ table ] );

    async function scan( startKey? : Record<string, unknown>, replace : boolean = false ) : Promise<void>
    {
        if ( !table ) return;
        setLoading( true );
        const r = await api.dynamoScan( table, startKey );
        setLoading( false );
        if ( r.error ) { setMsg( { kind: "err", text: r.error } ); return; }
        setItems( ( prev ) => replace ? r.items : [ ...prev, ...r.items ] );
        setLastKey( r.lastKey );
    }

    function clearEditor() : void { setDraft( "" ); setOriginal( "" ); setIsNew( false ); setMsg( null ); }

    function openItem( item : Record<string, unknown> ) : void
    {
        const text : string = JSON.stringify( item, null, 2 );
        setDraft( text ); setOriginal( text ); setIsNew( false ); setMsg( null );
    }

    function newItem() : void
    {
        const tmpl : Record<string, unknown> = {};
        if ( keySchema?.partitionKey ) tmpl[ keySchema.partitionKey ] = "";
        if ( keySchema?.sortKey ) tmpl[ keySchema.sortKey ] = "";
        const text : string = JSON.stringify( tmpl, null, 2 );
        setDraft( text ); setOriginal( "" ); setIsNew( true ); setMsg( null );
    }

    const jsonError : string | null = useMemo<string | null>( () =>
    {
        if ( draft.trim() === "" ) return null;
        try { const v = JSON.parse( draft ); if ( typeof v !== "object" || v === null || Array.isArray( v ) ) return "must be a JSON object"; return null; }
        catch ( e ) { return ( e as Error ).message; }
    }, [ draft ] );

    const dirty : boolean = draft !== original;

    async function onSave() : Promise<void>
    {
        if ( !table || jsonError || draft.trim() === "" ) return;
        setSaving( true ); setMsg( null );
        const r = await api.dynamoPut( table, JSON.parse( draft ) );
        setSaving( false );
        if ( !r.ok ) { setMsg( { kind: "err", text: r.error ?? "Save failed" } ); return; }
        setMsg( { kind: "ok", text: "Saved" } );
        setOriginal( draft ); setIsNew( false );
        void scan( undefined, true );
    }

    async function onDelete() : Promise<void>
    {
        if ( !table || !keySchema || draft.trim() === "" ) return;
        let item : Record<string, unknown>;
        try { item = JSON.parse( draft ); } catch { return; }
        const key : Record<string, unknown> = { [ keySchema.partitionKey ]: item[ keySchema.partitionKey ] };
        if ( keySchema.sortKey ) key[ keySchema.sortKey ] = item[ keySchema.sortKey ];
        setSaving( true ); setMsg( null );
        const r = await api.dynamoDelete( table, key );
        setSaving( false );
        if ( !r.ok ) { setMsg( { kind: "err", text: r.error ?? "Delete failed" } ); return; }
        clearEditor();
        void scan( undefined, true );
    }

    function rowLabel( item : Record<string, unknown> ) : string
    {
        if ( !keySchema ) return JSON.stringify( item ).slice( 0, 60 );
        const pk : string = String( item[ keySchema.partitionKey ] ?? "" );
        const sk : string = keySchema.sortKey ? " · " + String( item[ keySchema.sortKey ] ?? "" ) : "";
        return pk + sk;
    }


    // ── render ───────────────────────────────────────────────────────────────────────────────────
    if ( loadingTables )
        return <Box sx={{ p: 2, display: "flex", alignItems: "center", gap: 1 }}><CircularProgress size={16} /><Typography variant="caption">loading tables…</Typography></Box>;

    if ( treeError )
        return <Box sx={{ p: 2 }}><Typography variant="body2" sx={{ color: "warning.main" }}>{treeError}</Typography></Box>;

    if ( tables.length === 0 )
        return <Box sx={{ p: 2 }}><Typography variant="body2" sx={{ color: "text.disabled" }}>“{service}” owns no DynamoDB tables (or none are deployed).</Typography></Box>;

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            {/* toolbar */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                <Typography variant="caption" sx={{ color: "text.disabled" }}>table</Typography>
                <Select size="small" value={table} onChange={( e ) => setTable( e.target.value )} sx={{ minWidth: 180, fontFamily: MONO, fontSize: 13 }}>
                    {tables.map( ( t ) => <MenuItem key={t.name} value={t.name} sx={{ fontFamily: MONO, fontSize: 13 }}>{t.key}</MenuItem> )}
                </Select>
                {keySchema && <Chip size="small" variant="outlined" sx={{ fontFamily: MONO }} label={`PK ${keySchema.partitionKey}${keySchema.sortKey ? " · SK " + keySchema.sortKey : ""}`} />}
                <Box sx={{ flexGrow: 1 }} />
                <Tooltip title={readOnly ? "Real AWS — editing disabled (switch target to LocalStack)" : "Current AWS target"}>
                    <Chip size="small" variant="outlined" color={readOnly ? "warning" : "default"} label={targetInfo ? ( targetInfo.target.kind === "aws" ? `aws · ${targetInfo.target.profile ?? ""}` : "localstack" ) : "…"} sx={{ fontFamily: MONO }} />
                </Tooltip>
                <Tooltip title="Refresh"><IconButton size="small" onClick={() => void scan( undefined, true )}><RefreshIcon fontSize="small" /></IconButton></Tooltip>
                <Button size="small" variant="outlined" startIcon={<AddIcon />} disabled={readOnly} onClick={newItem}>New</Button>
            </Box>

            {/* split: item list (left) + editor (right) */}
            <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
                {/* list */}
                <Box sx={{ width: 280, flexShrink: 0, borderRight: "1px solid", borderColor: "divider", overflow: "auto", bgcolor: "#0a0d12" }}>
                    {items.map( ( it, i ) => (
                        <Box key={i} onClick={() => openItem( it )}
                             sx={{ px: 1.25, py: 0.75, fontFamily: MONO, fontSize: 12, color: "#e6edf3", cursor: "pointer", borderBottom: "1px solid #161b22", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", "&:hover": { bgcolor: "#161b22" } }}>
                            {rowLabel( it )}
                        </Box>
                    ) )}
                    {loading && <Box sx={{ p: 1, display: "flex", justifyContent: "center" }}><CircularProgress size={14} /></Box>}
                    {!loading && items.length === 0 && <Typography variant="caption" sx={{ display: "block", p: 1.5, color: "text.disabled", fontFamily: MONO }}>no items</Typography>}
                    {lastKey && !loading && (
                        <Box sx={{ p: 1, textAlign: "center" }}>
                            <Button size="small" onClick={() => void scan( lastKey )}>Load more</Button>
                        </Box>
                    )}
                </Box>

                {/* editor */}
                <Box sx={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    {( msg || jsonError ) && (
                        <Box sx={{ px: 1.5, py: 0.5, borderBottom: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
                            {jsonError
                                ? <Typography variant="caption" sx={{ color: "#f85149", fontFamily: MONO }}>invalid JSON — {jsonError}</Typography>
                                : <Typography variant="caption" sx={{ color: msg!.kind === "ok" ? "#3fb950" : "#f85149", fontFamily: MONO }}>{msg!.text}</Typography>}
                        </Box>
                    )}
                    <Box component="textarea"
                         value={draft}
                         spellCheck={false}
                         readOnly={readOnly}
                         placeholder={"select an item, or New…"}
                         onChange={( e : React.ChangeEvent<HTMLTextAreaElement> ) => setDraft( e.target.value )}
                         sx={{ flexGrow: 1, minHeight: 0, width: "100%", boxSizing: "border-box", resize: "none", border: "none", outline: "none",
                               bgcolor: "#0a0d12", color: "#e6edf3", fontFamily: MONO, fontSize: 13, lineHeight: 1.5, p: 1.5 }} />
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.75, borderTop: "1px solid", borderColor: "divider" }}>
                        <Button size="small" variant="contained" startIcon={saving ? <CircularProgress size={14} /> : <SaveIcon />}
                                disabled={saving || readOnly || !!jsonError || !dirty || draft.trim() === ""} onClick={() => void onSave()}>
                            {isNew ? "Create" : "Save"}
                        </Button>
                        <Box sx={{ flexGrow: 1 }} />
                        <Tooltip title="Delete this item">
                            <span><IconButton size="small" color="error" disabled={saving || readOnly || isNew || draft.trim() === ""} onClick={() => void onDelete()}><DeleteIcon fontSize="small" /></IconButton></span>
                        </Tooltip>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
