//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Stack, Typography } from "@mui/material";
import AddOutlinedIcon           from '@mui/icons-material/AddOutlined';
import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';

import { Segment } from '@repo/api';

import SelectInput  from '@widgets/core/SelectInput';
import ButtonIcon   from '@widgets/core/ButtonIcon';
import SegmentConditionRow from '@pages/contacts/dialogs/SegmentConditionRow';

// Group boolean-operator labels — the reference UI's "all of / any of / none of". Pure constant → module scope.
const GROUP_OP_CHOICES : Array<SelectInput.Choice> =
[
    { value: Segment.GroupOp.ALL,  label: "all of" },
    { value: Segment.GroupOp.ANY,  label: "any of" },
    { value: Segment.GroupOp.NONE, label: "none of" },
];

//
// SegmentGroupEditor — renders one boolean group of the segment query: its operator (all/any/none) plus its
// rules, where each rule is either a condition (SegmentConditionRow) or a nested group (this component,
// recursively) — so the query is arbitrarily hierarchical. Fully controlled: the parent owns the group and
// gets every edit via `onChange`. The ROOT group reads "Contacts belonging to [all of]"; nested groups render
// in an indented, bordered box with a delete.
//
export function SegmentGroupEditor( props : SegmentGroupEditor.Props ) : JSX.Element
{
    const isRoot : boolean = props.isRoot === true;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // is this rule a nested group (has an `op`) rather than a leaf condition?
    function isGroup( rule : Segment.Condition | Segment.Group ) : rule is Segment.Group
    {
        return "op" in rule;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function setOp( op : string ) : void
    {
        props.onChange( { ...props.group, op: op as Segment.GroupOp } );
    }
    function replaceAt( index : number, rule : Segment.Condition | Segment.Group ) : void
    {
        props.onChange( { ...props.group, conditions: props.group.conditions.map( ( existing : Segment.Condition | Segment.Group, at : number ) => at === index ? rule : existing ) } );
    }
    function removeAt( index : number ) : void
    {
        props.onChange( { ...props.group, conditions: props.group.conditions.filter( ( _existing : Segment.Condition | Segment.Group, at : number ) : boolean => at !== index ) } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // append a fresh condition (first field + its first operator) or a fresh empty sub-group
    function addCondition() : void
    {
        const field : Segment.FilterField = props.fields[ 0 ];
        const operators : Array<Segment.Operator> = Segment.operatorsFor( field );
        const condition : Segment.Condition = { field: field.id, operator: operators[ 0 ] };
        props.onChange( { ...props.group, conditions: [ ...props.group.conditions, condition ] } );
    }
    function addGroup() : void
    {
        const group : Segment.Group = { op: Segment.GroupOp.ALL, conditions: [] };
        props.onChange( { ...props.group, conditions: [ ...props.group.conditions, group ] } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack spacing={ 1 } sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1, width: "100%", boxSizing: "border-box", ml: isRoot ? 0 : 2, bgcolor: isRoot ? "action.hover" : "background.paper" }}>
                {/* header row — the group operator + add controls (+ delete for a nested group) */}
                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>
                        { isRoot ? "Contacts belonging to" : "Match" }
                    </Typography>
                    <SelectInput id="group-op" label={"Comparison"} value={ props.group.op } choices={ GROUP_OP_CHOICES } onChange={ setOp } sx={{ width: 140 }} />
                    <Box sx={{ flexGrow: 1 }} />
                    <Button size="small" startIcon={ <AddOutlinedIcon /> } onClick={ addCondition }>{"Add rule"}</Button>
                    <Button size="small" startIcon={ <CreateNewFolderOutlinedIcon /> } onClick={ addGroup }>{"Add group"}</Button>
                    { !isRoot && props.onDelete &&
                        <ButtonIcon id="group-remove" label={"Remove group"} size="small" icon={ <DeleteOutlineOutlinedIcon fontSize="small" /> } onClick={ props.onDelete } /> }
                </Stack>

                {/* rules — a condition row or a nested group, in order */}
                { props.group.conditions.length === 0 &&
                    <Typography variant="caption" sx={{ color: "text.secondary", pl: 1 }}>{"No rules yet — add a rule or a group."}</Typography> }
                { props.group.conditions.map( ( rule : Segment.Condition | Segment.Group, index : number ) : JSX.Element =>
                    isGroup( rule )
                        ? <SegmentGroupEditor key={ `g-${ index }` } group={ rule } fields={ props.fields } choicesFor={ props.choicesFor } onChange={ ( updated : Segment.Group ) : void => replaceAt( index, updated ) } onDelete={ () => removeAt( index ) } />
                        : <SegmentConditionRow key={ `c-${ index }` } condition={ rule } fields={ props.fields } choicesFor={ props.choicesFor } onChange={ ( updated : Segment.Condition ) : void => replaceAt( index, updated ) } onDelete={ () => removeAt( index ) } />
                ) }
            </Stack>;
}

export namespace SegmentGroupEditor
{
    export interface Props
    {
        group    : Segment.Group;
        fields   : Array<Segment.FilterField>;
        choicesFor? : ( field : Segment.FilterField ) => Array<SelectInput.Choice> | undefined;   // runtime operand choices, threaded to each row
        isRoot?  : boolean;
        onChange : ( group : Segment.Group ) => void;
        onDelete? : () => void;
    }
}

export default SegmentGroupEditor;
