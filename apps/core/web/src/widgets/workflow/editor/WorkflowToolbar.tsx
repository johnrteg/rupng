//
import React from "react";
import { JSX } from "react";
import { Stack, Typography, Button, Chip } from "@mui/material";

import Pusher from "@widgets/core/Pusher";
import ButtonIcon from "@widgets/core/ButtonIcon";
import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";
import UndoOutlinedIcon from "@mui/icons-material/UndoOutlined";
import RedoOutlinedIcon from "@mui/icons-material/RedoOutlined";

import { Workflow } from "@repo/api";
import { WorkflowEditorContext, type WorkflowEditorContextValue } from "./WorkflowEditorContext";
import { WorkflowEditorActionType } from "./WorkflowEditorModel";

export namespace WorkflowToolbar
{
    export interface Props
    {
        name:      string;
        status:    Workflow.Status;
        saving:    boolean;
        publishing: boolean;
        onBack:    () => void;
        onSave:    () => void;
        onPublish: () => void;
    }
}

//
// WorkflowToolbar — back / name+status / undo/redo (dispatched straight to the reducer, since history
// lives there) / Save / Publish. No autosave (matches the SVG editor's explicit-save convention).
//
export function WorkflowToolbar( props : WorkflowToolbar.Props ) : JSX.Element
{
    const editor : WorkflowEditorContextValue = React.useContext( WorkflowEditorContext );

    function onUndo() : void { editor.dispatch( { type: WorkflowEditorActionType.UNDO } ); }
    function onRedo() : void { editor.dispatch( { type: WorkflowEditorActionType.REDO } ); }

    return (
        <Stack direction="row" spacing={ 1 } sx={ { alignItems: "center", px: 2, py: 1, borderBottom: "1px solid", borderColor: "divider" } }>
            <ButtonIcon id="workflow-editor-back" label="Back to workflows" icon={ <ArrowBackOutlinedIcon /> } onClick={ props.onBack } />
            <Typography variant="subtitle2">{ props.name || "Untitled workflow" }</Typography>
            <Chip size="small" label={ props.status } color={ props.status === Workflow.Status.PUBLISHED ? "success" : "default" } />

            <Pusher />

            <ButtonIcon id="workflow-editor-undo" label="Undo" icon={ <UndoOutlinedIcon /> } disabled={ editor.state.history.past.length === 0 } onClick={ onUndo } />
            <ButtonIcon id="workflow-editor-redo" label="Redo" icon={ <RedoOutlinedIcon /> } disabled={ editor.state.history.future.length === 0 } onClick={ onRedo } />

            <Button size="small" variant="outlined" disabled={ props.saving } onClick={ props.onSave }>Save</Button>
            <Button size="small" variant="contained" disabled={ props.publishing } onClick={ props.onPublish }>Publish</Button>
        </Stack>
    );
}

export default WorkflowToolbar;
