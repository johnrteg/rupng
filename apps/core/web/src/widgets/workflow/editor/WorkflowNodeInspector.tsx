//
import React from "react";
import { JSX } from "react";
import { Box, Stack, Typography, Divider } from "@mui/material";

import TextInput from "@widgets/core/TextInput";
import SelectInput from "@widgets/core/SelectInput";
import ButtonIcon from "@widgets/core/ButtonIcon";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";

import { Workflow } from "@repo/api";
import { WorkflowEditorContext, type WorkflowEditorContextValue } from "./WorkflowEditorContext";
import { WorkflowEditorActionType } from "./WorkflowEditorModel";
import { nodeKindOf } from "./WorkflowEditorModel";

/** JsonLogic operator <-> a friendly picker label, for the `if` node's condition — a small structured
 *  builder (field/operator/value) rather than a raw JSON textarea, per the house convention of not
 *  exposing raw config where a typed widget will do. */
const CONDITION_OPERATORS : Array<{ value : string; label : string }> =
[
    { value: "==", label: "equals" },
    { value: "!=", label: "does not equal" },
    { value: ">",  label: "greater than" },
    { value: "<",  label: "less than" },
    { value: "in", label: "contains" },
];

interface ConditionRule { field : string; op : string; value : string; }

function parseCondition( condition : unknown ) : ConditionRule
{
    if( condition && typeof condition === "object" )
        for( const op of CONDITION_OPERATORS.map( ( entry ) : string => entry.value ) )
        {
            const args : unknown = ( condition as Record<string, unknown> )[ op ];
            if( Array.isArray( args ) && args.length === 2 )
            {
                const field : unknown = op === "in" ? ( args[ 1 ] as { var? : string } )?.var : ( args[ 0 ] as { var? : string } )?.var;
                const value : unknown = op === "in" ? args[ 0 ] : args[ 1 ];
                if( typeof field === "string" ) return { field, op, value: String( value ?? "" ) };
            }
        }
    return { field: "", op: "==", value: "" };
}

function buildCondition( rule : ConditionRule ) : unknown
{
    if( !rule.field ) return true;
    return rule.op === "in" ? { in: [ rule.value, { var: rule.field } ] } : { [ rule.op ]: [ { var: rule.field }, rule.value ] };
}

//
// WorkflowNodeInspector — the right-side panel. When a node is selected, renders type-specific config
// fields (reusing house widgets — TextInput/SelectInput — never a raw JSON textarea); when an edge is
// selected, shows its endpoints + a delete action. Empty otherwise.
//
export function WorkflowNodeInspector() : JSX.Element
{
    const editor : WorkflowEditorContextValue = React.useContext( WorkflowEditorContext );
    const definition : Workflow.Entity | null = editor.state.definition;

    const node : Workflow.Node | undefined = definition?.nodes.find( ( node : Workflow.Node ) : boolean => node.id === editor.state.selectedNodeId );
    const edge : Workflow.Edge | undefined = definition?.edges.find( ( edge : Workflow.Edge ) : boolean => edge.id === editor.state.selectedEdgeId );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function updateConfig( nodeId : string, config : Record<string, unknown> ) : void
    {
        editor.dispatch( { type: WorkflowEditorActionType.UPDATE_NODE_CONFIG, nodeId, config } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onLabelChanged( value : string ) : void
    {
        if( node ) updateConfig( node.id, { ...node.config, label: value } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onConditionFieldChanged( value : string ) : void
    {
        if( !node ) return;
        const rule : ConditionRule = { ...parseCondition( node.config.condition ), field: value };
        updateConfig( node.id, { ...node.config, condition: buildCondition( rule ) } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onConditionOpChanged( value : string ) : void
    {
        if( !node ) return;
        const rule : ConditionRule = { ...parseCondition( node.config.condition ), op: value };
        updateConfig( node.id, { ...node.config, condition: buildCondition( rule ) } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onConditionValueChanged( value : string ) : void
    {
        if( !node ) return;
        const rule : ConditionRule = { ...parseCondition( node.config.condition ), value };
        updateConfig( node.id, { ...node.config, condition: buildCondition( rule ) } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onBodyChanged( value : string ) : void
    {
        if( node ) updateConfig( node.id, { ...node.config, body: value } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onDurationChanged( value : string ) : void
    {
        if( node ) updateConfig( node.id, { ...node.config, durationSeconds: Number( value ) || 0 } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onDeleteNode() : void
    {
        if( node ) editor.dispatch( { type: WorkflowEditorActionType.DELETE_NODE, nodeId: node.id } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onDeleteEdge() : void
    {
        if( edge ) editor.dispatch( { type: WorkflowEditorActionType.DELETE_EDGE, edgeId: edge.id } );
    }

    if( !node && !edge )
        return (
            <Box sx={ { width: 280, flexShrink: 0, borderLeft: "1px solid", borderColor: "divider", p: 2 } }>
                <Typography variant="body2" color="text.secondary">Select a node or path to edit its settings.</Typography>
            </Box>
        );

    if( edge )
        return (
            <Box sx={ { width: 280, flexShrink: 0, borderLeft: "1px solid", borderColor: "divider", p: 2 } }>
                <Typography variant="subtitle2" sx={ { mb: 1 } }>Path</Typography>
                <Typography variant="body2" color="text.secondary">{ edge.sourceHandle } &rarr; { edge.target }</Typography>
                <Divider sx={ { my: 2 } } />
                <ButtonIcon id="workflow-delete-edge" label="Delete path" icon={ <DeleteOutlinedIcon /> } onClick={ onDeleteEdge } />
            </Box>
        );

    const kind = nodeKindOf( node!.type );
    const condition : ConditionRule = parseCondition( node!.config.condition );

    return (
        <Box sx={ { width: 280, flexShrink: 0, borderLeft: "1px solid", borderColor: "divider", p: 2, overflowY: "auto" } }>
            <Typography variant="subtitle2" sx={ { mb: 1 } }>{ kind.label }</Typography>
            <Stack spacing={ 2 }>
                { node!.type !== Workflow.NodeType.START && node!.type !== Workflow.NodeType.END &&
                    <TextInput id="workflow-node-label" label="Label" value={ String( node!.config.label ?? "" ) } onChange={ onLabelChanged } fullWidth /> }

                { node!.type === Workflow.NodeType.IF &&
                    <Stack spacing={ 1.5 }>
                        <TextInput id="workflow-node-condition-field" label="Field (e.g. trigger.tag)" value={ condition.field } onChange={ onConditionFieldChanged } fullWidth />
                        <SelectInput id="workflow-node-condition-op" label="Operator" value={ condition.op } choices={ CONDITION_OPERATORS } onChange={ onConditionOpChanged } />
                        <TextInput id="workflow-node-condition-value" label="Value" value={ condition.value } onChange={ onConditionValueChanged } fullWidth />
                    </Stack> }

                { node!.type === Workflow.NodeType.SEND_TEXT &&
                    <TextInput id="workflow-node-body" label="Message body" value={ String( node!.config.body ?? "" ) } onChange={ onBodyChanged } multiline maxRows={ 6 } fullWidth /> }

                { ( node!.type === Workflow.NodeType.SLEEP || node!.type === Workflow.NodeType.WAIT_FOR_RESPONSE ) &&
                    <TextInput id="workflow-node-duration" label="Duration (seconds)" value={ String( node!.config.durationSeconds ?? "" ) } onChange={ onDurationChanged } allNumeric fullWidth /> }
            </Stack>
            <Divider sx={ { my: 2 } } />
            <ButtonIcon id="workflow-delete-node" label="Delete node" icon={ <DeleteOutlinedIcon /> } onClick={ onDeleteNode } />
        </Box>
    );
}

export default WorkflowNodeInspector;
