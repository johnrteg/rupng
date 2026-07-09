import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Divider, Stack, Typography } from "@mui/material";

import { Media, MediaConfig } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';

//
// ItemInfoDialog — the read-only metadata inspector for ONE item in an envelope (media-1.2/1.6): its own
// kind/mime/size/version/status, per-kind probed metrics (image/video/audio/document), and — for a derived
// item — its derivation provenance (job + AI provider/model/prompt + the source item it was made from). The
// parent owns open/close and passes the asset + item; this dialog is display-only.
//
export function ItemInfoDialog( props : ItemInfoDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const item : Media.Item = props.item;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a labelled value row (skips empty/undefined values)
    function row( label : string, value : string | number | boolean | undefined ) : JSX.Element | null
    {
        if( value === undefined || value === "" ) return null;
        return  <Box key={ label } sx={{ display: "flex", gap: 2, py: 0.25 }}>
                    <Typography variant="caption" sx={{ color: "text.secondary", width: 140, flexShrink: 0 }}>{ label }</Typography>
                    <Typography variant="body2" sx={{ wordBreak: "break-word" }}>{ String( value ) }</Typography>
                </Box>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a locale-formatted date-time from an ISO string
    function when( iso? : string ) : string | undefined { return iso ? appmodel.ui.locale.date_time_normal.format( new Date( iso ) ) : undefined; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a human label for the item — the ORIGINAL, else "Usage · profile"
    function itemLabel() : string
    {
        const usage : string = item.usage.charAt( 0 ).toUpperCase() + item.usage.slice( 1 );
        return item.profile ? `${ usage } · ${ item.profile }` : usage;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const image : Media.ImageMeta | undefined = item.meta?.image;
    const video : Media.VideoMeta | undefined = item.meta?.video;
    const audio : Media.AudioMeta | undefined = item.meta?.audio;
    const document : Media.DocumentMeta | undefined = item.meta?.document;
    const derivation : Media.Derivation | undefined = item.derivation;
    // the malware scan is on the envelope's ORIGINAL bytes — surface it on the original item's info
    const scan : Media.ScanResult | undefined = item.usage === Media.Usage.ORIGINAL ? props.asset.scan : undefined;

    // a human outcome label for a scan result (not-scanned / advanced-unscanned / threat / clean)
    function scanOutcome( result : Media.ScanResult ) : string
    {
        if( !result.clean ) return "Threat detected";
        // the noop / "none" provider is a pass-through — the file was NOT actually inspected
        if( result.provider === MediaConfig.ScanProvider.NONE || result.engine === "noop" ) return "Not scanned (scanning disabled)";
        if( result.failOpen ) return "Advanced UNSCANNED (engine unavailable)";
        return "Clean — no threat found";
    }

    return  <DialogWindow id="media-item-info"
                          title={ `Item — ${ itemLabel() }` }
                          cancelLabel={"Close"}
                          yesLabel={"Done"}
                          minWidth="sm"
                          onYes={ () => Promise.resolve( true ) }
                          onClose={ props.onClose }>
                <Stack spacing={ 1.5 } sx={{ p: 2 }}>

                    {/* ── general ─────────────────────────────────────────────────────────── */}
                    <Box>
                        <Typography variant="subtitle2">{ props.asset.name }</Typography>
                        <Box sx={{ mt: 0.5 }}>
                            { row( "Item", Media.itemKey( item.usage, item.profile ) ) }
                            { row( "Kind", item.kind ) }
                            { row( "MIME", item.mime ) }
                            { row( "Extension", item.extension ) }
                            { row( "Size", appmodel.ui.locale.bytes( item.size ) ) }
                            { row( "Version", `v${ item.version }` ) }
                            { row( "Status", item.status ) }
                            { row( "Created", when( item.createdAt ) ) }
                            { row( "Modified", when( item.modifiedAt ) ) }
                        </Box>
                    </Box>

                    {/* ── image stats ─────────────────────────────────────────────────────── */}
                    { image &&
                        <>
                            <Divider textAlign="left"><Typography variant="caption" sx={{ color: "text.secondary" }}>{"Image"}</Typography></Divider>
                            <Box>
                                { row( "Dimensions", `${ image.width } × ${ image.height } px` ) }
                                { row( "Format", image.format ) }
                                { row( "Color space", image.space ) }
                                { row( "Channels", image.channels ) }
                                { row( "Bit depth", image.depth ) }
                                { row( "Density", image.density ? `${ image.density } dpi` : undefined ) }
                                { row( "Alpha", image.hasAlpha ) }
                                { row( "Orientation", image.orientation ) }
                                { row( "Pages", image.pages ) }
                            </Box>
                        </>
                    }

                    {/* ── video stats ─────────────────────────────────────────────────────── */}
                    { video &&
                        <>
                            <Divider textAlign="left"><Typography variant="caption" sx={{ color: "text.secondary" }}>{"Video"}</Typography></Divider>
                            <Box>
                                { row( "Dimensions", video.width && video.height ? `${ video.width } × ${ video.height } px` : undefined ) }
                                { row( "Duration", video.durationSec !== undefined ? `${ video.durationSec.toFixed( 1 ) } s` : undefined ) }
                                { row( "Frame rate", video.frameRate !== undefined ? `${ video.frameRate } fps` : undefined ) }
                                { row( "Video codec", video.videoCodec ) }
                                { row( "Audio codec", video.audioCodec ?? "none" ) }
                                { row( "Bitrate", video.bitrate !== undefined ? `${ Math.round( video.bitrate / 1000 ) } kbps` : undefined ) }
                                { row( "Pixel format", video.pixelFormat ) }
                                { row( "Rotation", video.rotation !== undefined ? `${ video.rotation }°` : undefined ) }
                                { row( "Container", video.container ) }
                            </Box>
                        </>
                    }

                    {/* ── audio stats ─────────────────────────────────────────────────────── */}
                    { audio &&
                        <>
                            <Divider textAlign="left"><Typography variant="caption" sx={{ color: "text.secondary" }}>{"Audio"}</Typography></Divider>
                            <Box>
                                { row( "Duration", audio.durationSec !== undefined ? `${ audio.durationSec.toFixed( 1 ) } s` : undefined ) }
                                { row( "Bitrate", audio.bitrate !== undefined ? `${ Math.round( audio.bitrate / 1000 ) } kbps` : undefined ) }
                                { row( "Sample rate", audio.sampleRate !== undefined ? `${ audio.sampleRate } Hz` : undefined ) }
                                { row( "Channels", audio.channels ) }
                                { row( "Codec", audio.codec ) }
                            </Box>
                        </>
                    }

                    {/* ── document / transcript ───────────────────────────────────────────── */}
                    { document &&
                        <>
                            <Divider textAlign="left"><Typography variant="caption" sx={{ color: "text.secondary" }}>{"Document"}</Typography></Divider>
                            <Box>
                                { row( "Pages", document.pages ) }
                                { row( "Length", document.length !== undefined ? `${ document.length } chars` : undefined ) }
                                { row( "Transcript", document.transcript ? `${ document.transcript.segments.length } segments${ document.transcript.language ? ` · ${ document.transcript.language }` : "" }` : undefined ) }
                            </Box>
                        </>
                    }

                    {/* ── derivation provenance (derived items) ───────────────────────────── */}
                    { derivation &&
                        <>
                            <Divider textAlign="left"><Typography variant="caption" sx={{ color: "text.secondary" }}>{"Derivation"}</Typography></Divider>
                            <Box>
                                { row( "Job", derivation.job ) }
                                { row( "From item", derivation.sourceItemId ) }
                                { row( "AI provider", derivation.provider ) }
                                { row( "AI model", derivation.model ) }
                                { row( "Prompt", derivation.prompt ) }
                                { row( "Produced", when( derivation.producedAt ) ) }
                            </Box>
                        </>
                    }

                    {/* ── security scan (the original file's malware-scan result) ──────────────── */}
                    { scan &&
                        <>
                            <Divider textAlign="left"><Typography variant="caption" sx={{ color: "text.secondary" }}>{"Security scan"}</Typography></Divider>
                            <Box>
                                { row( "Result", scanOutcome( scan ) ) }
                                { row( "Threat", scan.threat ) }
                                { row( "Provider", scan.provider ) }
                                { row( "Engine", scan.engine ) }
                                { row( "Scanned", when( scan.scannedAt ) ) }
                            </Box>
                        </>
                    }

                    { !image && !video && !audio && !document && !derivation && !scan &&
                        <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No probed metadata for this item yet."}</Typography> }

                </Stack>
            </DialogWindow>;
}

export namespace ItemInfoDialog
{
    export interface Props
    {
        asset   : Media.Asset;
        item    : Media.Item;
        onClose : () => void;
    }
}

export default ItemInfoDialog;
// eof
