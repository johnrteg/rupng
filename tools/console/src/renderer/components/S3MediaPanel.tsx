import { useCallback, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import RefreshIcon from "@mui/icons-material/Refresh";
import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFileOutlined";
import DownloadIcon from "@mui/icons-material/Download";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

import type { S3Listing, S3Object, S3ObjectHead } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";

// ── module-scope pure helpers (console convention; see CloudView) ─────────────────────────────────
/** The last path segment of an S3 key/prefix ("a/b/c.png" → "c.png", "a/b/" → "b"). */
function basename( key : string ) : string
{
    const trimmed : string = key.endsWith( "/" ) ? key.slice( 0, -1 ) : key;
    const slash : number = trimmed.lastIndexOf( "/" );
    return slash >= 0 ? trimmed.slice( slash + 1 ) : trimmed;
}

/** Human-readable byte size. */
function humanSize( bytes : number ) : string
{
    if ( bytes < 1024 ) return `${ bytes } B`;
    const units : Array<string> = [ "KB", "MB", "GB", "TB" ];
    let size : number = bytes / 1024;
    let unit : number = 0;
    while ( size >= 1024 && unit < units.length - 1 ) { size /= 1024; unit++; }
    return `${ size.toFixed( size < 10 ? 1 : 0 ) } ${ units[ unit ] }`;
}

/** The file extension (no dot, lower-case) of a key. */
function extOf( key : string ) : string { return ( key.split( "." ).pop() ?? "" ).toLowerCase(); }

const IMAGE_EXT : ReadonlyArray<string> = [ "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "heic" ];
const VIDEO_EXT : ReadonlyArray<string> = [ "mp4", "mov", "webm", "m4v", "ogv" ];

//
// The Storage tab — a browser for the service's S3 bucket(s). Pick a bucket (the service's own sort
// first), walk its "folders" (delimiter "/"), click an object to see its metadata and a preview
// (image/video) or an open/download hand-off via a short-lived pre-signed URL. Read-only — safe on
// LocalStack and real AWS alike (no mutations).
//
export function S3MediaPanel( { service } : { service : string } )
{
    const [ buckets, setBuckets ]   = useState<Array<string>>( [] );
    const [ bucket, setBucket ]     = useState<string>( "" );
    const [ listing, setListing ]   = useState<S3Listing | null>( null );
    const [ prefix, setPrefix ]     = useState<string>( "" );
    const [ loading, setLoading ]   = useState<boolean>( true );

    const [ selected, setSelected ] = useState<S3Object | null>( null );
    const [ head, setHead ]         = useState<S3ObjectHead | null>( null );
    const [ url, setUrl ]           = useState<string>( "" );

    // ── buckets (service's own first) ─────────────────────────────────────────────────────────────
    useEffect( () =>
    {
        void api.s3Buckets( service ).then( ( names : Array<string> ) =>
        {
            setBuckets( names );
            setBucket( names[ 0 ] ?? "" );
        } );
    }, [ service ] );

    // ── list one prefix ─────────────────────────────────────────────────────────────────────────
    const load = useCallback( async ( atPrefix : string ) : Promise<void> =>
    {
        if ( !bucket ) return;
        setLoading( true );
        setSelected( null ); setHead( null ); setUrl( "" );
        try { setListing( await api.s3List( bucket, atPrefix ) ); setPrefix( atPrefix ); }
        finally { setLoading( false ); }
    }, [ bucket ] );

    useEffect( () => { if ( bucket ) void load( "" ); }, [ bucket, load ] );

    // ── select an object → metadata + presigned preview url ───────────────────────────────────────
    async function openObject( object : S3Object ) : Promise<void>
    {
        setSelected( object );
        setHead( null ); setUrl( "" );
        const [ meta, signed ] : [ S3ObjectHead, string ] = await Promise.all( [
            api.s3Head( bucket, object.key ),
            api.s3PresignGet( bucket, object.key )
        ] );
        setHead( meta );
        setUrl( signed );
    }

    // ── breadcrumb segments for the current prefix ────────────────────────────────────────────────
    const segments : Array<string> = prefix.split( "/" ).filter( ( segment ) => segment.length > 0 );
    const ext : string = selected ? extOf( selected.key ) : "";
    const isImage : boolean = IMAGE_EXT.includes( ext );
    const isVideo : boolean = VIDEO_EXT.includes( ext );

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, p: 1.5, gap: 1 }}>

            {/* ── toolbar: bucket picker + refresh ─────────────────────────────────────────── */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Select size="small" value={ bucket } displayEmpty onChange={ ( e ) => setBucket( e.target.value ) }
                        sx={{ minWidth: 280, fontFamily: MONO, fontSize: 12 }}>
                    { buckets.length === 0 && <MenuItem value="" disabled>{ "no buckets" }</MenuItem> }
                    { buckets.map( ( name ) => <MenuItem key={ name } value={ name } sx={{ fontFamily: MONO, fontSize: 12 }}>{ name }</MenuItem> ) }
                </Select>
                <Tooltip title="Refresh"><span><IconButton size="small" onClick={ () => void load( prefix ) } disabled={ !bucket || loading }><RefreshIcon fontSize="small" /></IconButton></span></Tooltip>
                { loading && <CircularProgress size={ 16 } /> }
            </Box>

            {/* ── breadcrumb ───────────────────────────────────────────────────────────────── */}
            { bucket &&
                <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.25 }}>
                    <Button size="small" onClick={ () => void load( "" ) } sx={{ minWidth: 0, textTransform: "none", fontFamily: MONO, fontSize: 12 }}>{ bucket }</Button>
                    { segments.map( ( segment, index ) =>
                        <Box key={ index } sx={{ display: "flex", alignItems: "center" }}>
                            <Typography sx={{ color: "text.secondary", fontSize: 12 }}>{ "/" }</Typography>
                            <Button size="small" onClick={ () => void load( segments.slice( 0, index + 1 ).join( "/" ) + "/" ) }
                                    sx={{ minWidth: 0, textTransform: "none", fontFamily: MONO, fontSize: 12 }}>{ segment }</Button>
                        </Box>
                    ) }
                </Box>
            }

            {/* ── body: object list (left) + detail (right) ────────────────────────────────── */}
            <Box sx={{ display: "flex", gap: 1.5, flexGrow: 1, minHeight: 0 }}>

                {/* list */}
                <Box sx={{ flex: 1, minWidth: 0, border: "1px solid", borderColor: "divider", borderRadius: 1.5, overflow: "auto" }}>
                    { listing?.error && <Typography sx={{ p: 1.5, color: "error.main", fontSize: 12 }}>{ listing.error }</Typography> }
                    { listing && !listing.error && listing.folders.length === 0 && listing.objects.length === 0 &&
                        <Typography sx={{ p: 1.5, color: "text.secondary", fontSize: 12 }}>{ "empty" }</Typography> }

                    { ( listing?.folders ?? [] ).map( ( folder ) =>
                        <Box key={ folder } onClick={ () => void load( folder ) }
                             sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.75, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}>
                            <FolderIcon fontSize="small" sx={{ color: "warning.light" }} />
                            <Typography sx={{ fontFamily: MONO, fontSize: 12 }}>{ basename( folder ) }/</Typography>
                        </Box>
                    ) }

                    { ( listing?.objects ?? [] ).map( ( object ) =>
                        <Box key={ object.key } onClick={ () => void openObject( object ) }
                             sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.75, cursor: "pointer",
                                   bgcolor: selected?.key === object.key ? "action.selected" : undefined, "&:hover": { bgcolor: "action.hover" } }}>
                            <InsertDriveFileIcon fontSize="small" sx={{ color: "text.secondary" }} />
                            <Typography sx={{ fontFamily: MONO, fontSize: 12, flexGrow: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ basename( object.key ) }</Typography>
                            <Typography sx={{ color: "text.secondary", fontSize: 11 }}>{ humanSize( object.size ) }</Typography>
                        </Box>
                    ) }

                    { listing?.truncated && <Typography sx={{ p: 1, color: "text.secondary", fontSize: 11 }}>{ "… more (first 1000 shown)" }</Typography> }
                </Box>

                {/* detail */}
                <Box sx={{ flex: 1, minWidth: 0, border: "1px solid", borderColor: "divider", borderRadius: 1.5, overflow: "auto", p: 1.5 }}>
                    { !selected && <Typography sx={{ color: "text.secondary", fontSize: 12 }}>{ "Select an object to inspect." }</Typography> }
                    { selected &&
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                            <Typography sx={{ fontFamily: MONO, fontSize: 13, wordBreak: "break-all" }}>{ selected.key }</Typography>

                            {/* preview */}
                            { url && isImage &&
                                <Box component="img" src={ url } alt={ selected.key } sx={{ maxWidth: "100%", maxHeight: 280, objectFit: "contain", borderRadius: 1, bgcolor: "background.default" }} /> }
                            { url && isVideo &&
                                <Box component="video" src={ url } controls sx={{ maxWidth: "100%", maxHeight: 280, borderRadius: 1, bgcolor: "background.default" }} /> }

                            {/* metadata */}
                            { head?.error && <Typography sx={{ color: "error.main", fontSize: 12 }}>{ head.error }</Typography> }
                            { head && !head.error &&
                                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                                    <Chip size="small" variant="outlined" label={ humanSize( head.size ) } />
                                    { head.contentType && <Chip size="small" variant="outlined" label={ head.contentType } /> }
                                    { head.storageClass && <Chip size="small" variant="outlined" label={ head.storageClass } /> }
                                    { head.lastModified && <Chip size="small" variant="outlined" label={ new Date( head.lastModified ).toLocaleString() } /> }
                                    { head.versionId && head.versionId !== "null" && <Chip size="small" variant="outlined" label={ `v ${ head.versionId.slice( 0, 8 ) }` } /> }
                                </Box>
                            }

                            { head?.metadata && Object.keys( head.metadata ).length > 0 &&
                                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
                                    <Typography sx={{ color: "text.secondary", fontSize: 11 }}>{ "user metadata" }</Typography>
                                    { Object.entries( head.metadata ).map( ( [ key, value ] ) =>
                                        <Typography key={ key } sx={{ fontFamily: MONO, fontSize: 11 }}>{ `${ key }: ${ value }` }</Typography>
                                    ) }
                                </Box>
                            }

                            {/* actions */}
                            <Box sx={{ display: "flex", gap: 1, mt: 0.5 }}>
                                <Button size="small" variant="outlined" startIcon={ <OpenInNewIcon fontSize="small" /> } disabled={ !url } onClick={ () => url && void api.openExternal( url ) } sx={{ textTransform: "none" }}>{ "Open" }</Button>
                                <Button size="small" variant="outlined" startIcon={ <DownloadIcon fontSize="small" /> } disabled={ !url } component="a" href={ url } download={ basename( selected.key ) } sx={{ textTransform: "none" }}>{ "Download" }</Button>
                            </Box>
                        </Box>
                    }
                </Box>
            </Box>
        </Box>
    );
}
