import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Chip, Divider, Stack, Typography } from "@mui/material";

import { Audit } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';

//
// AuditEventDetailDialog — a read-only inspector for one audit event: the full envelope (actor/target/
// source/outcome/context) plus its tamper-evidence stamps (seq/prevHash/hash/legalHold). Parent owns
// open/close; this dialog fetches nothing itself (the row is already in hand from the list page).
//
export function AuditEventDetailDialog( props : AuditEventDetailDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const event : Audit.EventView = props.event;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a labelled value row (skips empty/undefined values) — mirrors media's AssetInfoDialog pattern
    function row( label : string, value : string | number | boolean | undefined | null ) : JSX.Element | null
    {
        if( value === undefined || value === null || value === "" ) return null;
        return  <Box key={ label } sx={{ display: "flex", gap: 2, py: 0.25 }}>
                    <Typography variant="caption" sx={{ color: "text.secondary", width: 130, flexShrink: 0 }}>{ label }</Typography>
                    <Typography variant="body2" sx={{ wordBreak: "break-word", fontFamily: label === "Hash" || label === "Prev hash" ? "monospace" : undefined }}>{ String( value ) }</Typography>
                </Box>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the context sub-object rendered as one row per key (PII-light — ids/enums/counts only)
    function contextRows() : Array<JSX.Element | null>
    {
        const context : Record<string, unknown> = event.context ?? {};
        return Object.keys( context ).map( ( key : string ) : JSX.Element | null => row( key, context[ key ] as string | number | boolean ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="audit-event-detail"
                          title={"Audit event"}
                          yesLabel={"Done"}
                          cancelLabel={"Close"}
                          minWidth="sm"
                          onYes={ () => Promise.resolve( true ) }
                          onClose={ props.onClose }>
                <Stack spacing={ 1.5 } sx={{ p: 2 }}>

                    <Box>
                        <Typography variant="subtitle2">{ event.action }</Typography>
                        <Box sx={{ mt: 0.5 }}>
                            { row( "Occurred at", appmodel.ui.locale.date_time_normal.format( new Date( event.occurredAt ) ) ) }
                            { row( "Seq", event.seq ) }
                            { row( "Outcome", event.outcome ) }
                            { event.legalHold && <Chip size="small" color="warning" label={"Legal hold"} sx={{ mt: 0.5 }} /> }
                        </Box>
                    </Box>

                    <Divider />

                    <Box>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Who / what"}</Typography>
                        <Box sx={{ mt: 0.5 }}>
                            { row( "Actor", `${ event.actor.kind }:${ event.actor.id }` ) }
                            { row( "On behalf of", event.actor.onBehalfOfId ) }
                            { row( "Target", `${ event.target.type }:${ event.target.id }` ) }
                            { row( "Channel", event.source.channel ) }
                            { row( "IP", event.source.ip ) }
                        </Box>
                    </Box>

                    { Object.keys( event.context ?? {} ).length > 0 &&
                        <>
                            <Divider />
                            <Box>
                                <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Context"}</Typography>
                                <Box sx={{ mt: 0.5 }}>{ contextRows() }</Box>
                            </Box>
                        </> }

                    <Divider />

                    <Box>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Tamper-evidence"}</Typography>
                        <Box sx={{ mt: 0.5 }}>
                            { row( "Retention class", event.retentionClass ) }
                            { row( "Ingested at", appmodel.ui.locale.date_time_normal.format( new Date( event.ingestedAt ) ) ) }
                            { row( "Prev hash", event.prevHash ) }
                            { row( "Hash", event.hash ) }
                        </Box>
                    </Box>

                </Stack>
            </DialogWindow>;
}

export namespace AuditEventDetailDialog
{
    export interface Props
    {
        event   : Audit.EventView;
        onClose : () => void;
    }
}

export default AuditEventDetailDialog;
