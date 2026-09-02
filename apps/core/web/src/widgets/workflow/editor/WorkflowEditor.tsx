//
import React from "react";
import { JSX } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Box, Stack, CircularProgress } from "@mui/material";

import { RestfulService } from "@repo/endpoint";
import { Workflow } from "@repo/api";

import SnackAlert from "@widgets/core/SnackAlert";
import AppModel from "@model/AppModel";
import WorkflowService from "@model/service/WorkflowService";

import { WorkflowEditorContext } from "./WorkflowEditorContext";
import { workflowEditorReducer } from "./workflowEditorReducer";
import { makeInitialState, WorkflowEditorActionType } from "./WorkflowEditorModel";
import { WorkflowToolbar } from "./WorkflowToolbar";
import { WorkflowNodePalette } from "./WorkflowNodePalette";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { WorkflowNodeInspector } from "./WorkflowNodeInspector";

export namespace WorkflowEditor
{
    export interface Props
    {
        workflowId: string;
        onBack:     () => void;
    }
}

//
// WorkflowEditor — the editor shell (mirrors SvgDesignEditor's composition): owns the reducer, provides
// the context, and composes the toolbar + node palette + React Flow canvas + inspector as a flat row.
// Loads the definition on mount; Save (PATCH) and Publish (client-side Workflow.validateGraph first,
// then PostWorkflowPublish) are explicit actions — no autosave.
//
export function WorkflowEditor( props : WorkflowEditor.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const service : WorkflowService = React.useMemo( () : WorkflowService => new WorkflowService( appmodel ), [ appmodel ] );

    const [ state, dispatch ] = React.useReducer( workflowEditorReducer, makeInitialState() );
    const [ loading, setLoading ] = React.useState<boolean>( true );
    const [ saving, setSaving ] = React.useState<boolean>( false );
    const [ publishing, setPublishing ] = React.useState<boolean>( false );
    const [ snack, setSnack ] = React.useState<{ message : string; severity : SnackAlert.Severity } | null>( null );

    React.useEffect( componentLoaded, [ props.workflowId ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {
        void load();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<Workflow.Entity> = await service.get( props.workflowId );
        setLoading( false );
        if( !reply.ok || !reply.data ) { setSnack( { message: "Failed to load workflow.", severity: "error" } ); return; }
        dispatch( { type: WorkflowEditorActionType.SET_DEFINITION, definition: reply.data } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onSave() : Promise<void>
    {
        if( !state.definition ) return;
        setSaving( true );
        const reply : RestfulService.Reply<Workflow.Entity> = await service.update( state.definition.id, {
            name: state.definition.name, triggers: state.definition.triggers, nodes: state.definition.nodes, edges: state.definition.edges,
        } );
        setSaving( false );
        if( !reply.ok || !reply.data ) { setSnack( { message: "Save failed.", severity: "error" } ); return; }
        dispatch( { type: WorkflowEditorActionType.SET_DEFINITION, definition: reply.data } );
        setSnack( { message: "Saved.", severity: "success" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onPublish() : Promise<void>
    {
        if( !state.definition ) return;

        // client-side pre-publish check (the SAME Workflow.validateGraph the server re-runs) — catch
        // an incomplete graph (a missing "false" edge off an "if", an unreachable node, …) before the
        // round-trip, per README.md "at publish the whole graph is type-checked".
        const issues : Array<Workflow.GraphIssue> = Workflow.validateGraph( state.definition );
        if( issues.length > 0 )
        {
            setSnack( { message: `Cannot publish: ${issues[ 0 ].message}${ issues.length > 1 ? ` (+${issues.length - 1} more)` : "" }`, severity: "error" } );
            return;
        }

        setPublishing( true );
        const saved : RestfulService.Reply<Workflow.Entity> = await service.update( state.definition.id, {
            name: state.definition.name, triggers: state.definition.triggers, nodes: state.definition.nodes, edges: state.definition.edges,
        } );
        if( !saved.ok || !saved.data ) { setPublishing( false ); setSnack( { message: "Save-before-publish failed.", severity: "error" } ); return; }

        const reply : RestfulService.Reply<Workflow.Entity> = await service.publish( state.definition.id );
        setPublishing( false );
        if( !reply.ok || !reply.data ) { setSnack( { message: "Publish failed.", severity: "error" } ); return; }
        dispatch( { type: WorkflowEditorActionType.SET_DEFINITION, definition: reply.data } );
        setSnack( { message: `Published v${reply.data.version}.`, severity: "success" } );
    }

    if( loading || !state.definition )
        return <Stack sx={ { height: "100%", alignItems: "center", justifyContent: "center" } }><CircularProgress /></Stack>;

    return (
        <WorkflowEditorContext.Provider value={ { state, dispatch } }>
            <ReactFlowProvider>
                <Box sx={ { display: "flex", flexDirection: "column", height: "100%" } }>
                    <WorkflowToolbar
                        name={ state.definition.name }
                        status={ state.definition.status }
                        saving={ saving }
                        publishing={ publishing }
                        onBack={ props.onBack }
                        onSave={ onSave }
                        onPublish={ onPublish }
                    />
                    <Box sx={ { display: "flex", flexGrow: 1, minHeight: 0 } }>
                        <WorkflowNodePalette />
                        <WorkflowCanvas />
                        <WorkflowNodeInspector />
                    </Box>
                </Box>
            </ReactFlowProvider>
            { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () : void => setSnack( null ) } /> }
        </WorkflowEditorContext.Provider>
    );
}

export default WorkflowEditor;
