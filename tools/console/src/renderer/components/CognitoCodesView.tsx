import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import RefreshIcon from "@mui/icons-material/Refresh";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

import type { CognitoCode, CognitoCodeListing } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";

//
// CognitoCodesView — sits atop the Email sub-tab. Cognito's sign-up / reset codes aren't delivered by
// LocalStack (and never hit the SES capture); LocalStack just logs them. This surfaces the latest code
// per user straight from that log, so you can verify a registration without grepping docker. Dev-only.
//

/** Local time string for a captured-at epoch, or "" when unknown. */
function timeOf( at : number ) : string { return at > 0 ? new Date( at ).toLocaleTimeString() : ""; }

export function CognitoCodesView()
{
    const [ listing, setListing ] = useState<CognitoCodeListing | null>( null );
    const [ copied, setCopied ] = useState<string | null>( null );
    const timer = useRef<ReturnType<typeof setInterval> | null>( null );

    /** Pull the latest captured codes from the LocalStack log into state. */
    async function refresh() : Promise<void> { setListing( await api.cognitoCodes() ); }

    /** Copy a code to the clipboard + flash a "copied" chip on that row. */
    async function copy( code : string ) : Promise<void>
    {
        try { await navigator.clipboard.writeText( code ); setCopied( code ); setTimeout( () => setCopied( null ), 1200 ); }
        catch { /* clipboard blocked — the code is still visible to type */ }
    }

    useEffect( () =>
    {
        void refresh();
        timer.current = setInterval( () => { void refresh(); }, 3000 );   // codes appear as registrations happen
        return () => { if ( timer.current ) clearInterval( timer.current ); };
    }, [] );

    const codes : Array<CognitoCode> = listing?.codes ?? [];

    return (
        <Box sx={{ borderBottom: "1px solid", borderColor: "divider", flexShrink: 0, maxHeight: 220, display: "flex", flexDirection: "column" }}>
            {/* header */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.75 }}>
                <Typography variant="subtitle2" sx={{ fontFamily: MONO }}>Cognito codes</Typography>
                <Chip size="small" variant="outlined"
                      color={listing ? ( listing.ok ? "success" : "warning" ) : "default"}
                      label={listing ? ( listing.ok ? `${codes.length}` : "n/a" ) : "…"}
                      sx={{ fontFamily: MONO, height: 18 }} />
                <Typography variant="caption" sx={{ color: "text.disabled" }}>
                    verification codes from the LocalStack log (not delivered / not in SES)
                </Typography>
                <Box sx={{ flexGrow: 1 }} />
                <Tooltip title="Refresh"><IconButton size="small" onClick={() => void refresh()}><RefreshIcon fontSize="small" /></IconButton></Tooltip>
            </Box>

            {/* not-running / empty hints */}
            {listing && !listing.ok && (
                <Typography variant="caption" sx={{ px: 1.5, pb: 1, color: "warning.main" }}>{listing.error}</Typography>
            )}
            {listing?.ok && codes.length === 0 && (
                <Typography variant="caption" sx={{ px: 1.5, pb: 1, color: "text.secondary" }}>
                    No codes captured yet — register or request a reset and the code appears here.
                </Typography>
            )}

            {/* code rows */}
            {codes.length > 0 && (
                <Box sx={{ overflow: "auto" }}>
                    {codes.map( ( entry ) => (
                        <Box key={entry.user + entry.code}
                             sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 1.5, py: 0.5, borderTop: "1px solid", borderColor: "divider" }}>
                            <Typography sx={{ fontFamily: MONO, fontSize: 12, color: "text.secondary", flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {entry.user}
                            </Typography>
                            <Typography sx={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, letterSpacing: 1, color: "info.main" }}>
                                {entry.code}
                            </Typography>
                            <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO, width: 72, textAlign: "right" }}>
                                {timeOf( entry.at )}
                            </Typography>
                            <Tooltip title={copied === entry.code ? "Copied!" : "Copy code"}>
                                <IconButton size="small" onClick={() => void copy( entry.code )}>
                                    <ContentCopyIcon fontSize="small" color={copied === entry.code ? "success" : "inherit"} />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    ) )}
                </Box>
            )}
        </Box>
    );
}

export default CognitoCodesView;
