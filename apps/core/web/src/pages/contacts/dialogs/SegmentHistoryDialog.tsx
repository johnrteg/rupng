import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import { Segment, GetSegmentRuns } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow from '@widgets/core/DialogWindow';
import TableInput   from '@widgets/core/TableInput';

// run-history table columns (pure constant → module scope)
const RUN_COLUMNS : Array<TableInput.Column> =
[
    { field: "when",    label: "When",    type: TableInput.ColumnType.DATETIME, options: { style: "medium" } },
    { field: "who",     label: "Who",     type: TableInput.ColumnType.STRING },
    { field: "trigger", label: "Trigger", type: TableInput.ColumnType.STRING },
    { field: "added",   label: "Added",   type: TableInput.ColumnType.NUMBER },
    { field: "removed", label: "Removed", type: TableInput.ColumnType.NUMBER },
    { field: "total",   label: "Members", type: TableInput.ColumnType.NUMBER },
    { field: "status",  label: "Status",  type: TableInput.ColumnType.STRING },
];

//
// SegmentHistoryDialog — read-only list of a segment's materialization runs (when / who / added / removed /
// members / status). The parent owns open/close; this fetches the run log for the given segment.
//
export function SegmentHistoryDialog( props : SegmentHistoryDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const [runs,setRuns] = React.useState< Array<Segment.Run> >( [] );
    const [loading,setLoading] = React.useState< boolean >( true );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { void load(); }, [] );

    // load the segment's run history (newest first, server-ordered)
    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetSegmentRuns.Response> = await appmodel.server.fetch( new GetSegmentRuns( props.segment.id ) );
        if( reply.ok && reply.data ) setRuns( reply.data.records );
        setLoading( false );
    }

    // one display row per run
    function runRow( run : Segment.Run ) : TableInput.Row
    {
        return { id: run.at, when: new Date( run.at ), who: run.by ?? "—", trigger: run.trigger, added: run.added, removed: run.removed, total: run.total, status: run.status };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="segment-history"
                          title={ `History — ${ props.segment.name }` }
                          yesLabel={"Close"}
                          minWidth="md"
                          onYes={ () => Promise.resolve( true ) }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    { loading &&
                        <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography> }
                    { !loading && runs.length === 0 &&
                        <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", py: 3 }}>{"No runs yet — this segment hasn't been materialized."}</Typography> }
                    { !loading && runs.length > 0 &&
                        <TableInput id="segment-runs" columns={ RUN_COLUMNS } data={ runs.map( runRow ) } selectable={ TableInput.Selectable.NONE } /> }
                </Stack>
            </DialogWindow>;
}

export namespace SegmentHistoryDialog
{
    export interface Props
    {
        segment : Segment.Entity;
        onClose : () => void;
    }
}

export default SegmentHistoryDialog;
