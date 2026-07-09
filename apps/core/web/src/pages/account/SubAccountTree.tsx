//
import React from 'react';
import { JSX } from "react";

import { Box, Chip, Collapse, Stack, Typography } from "@mui/material";
import ExpandMoreIcon    from '@mui/icons-material/ExpandMore';
import ChevronRightIcon  from '@mui/icons-material/ChevronRight';
import MoreVertIcon      from '@mui/icons-material/MoreVert';

import { Account } from '@repo/api';

import ButtonIcon from '@widgets/core/ButtonIcon';
import ButtonIconDropdown from '@widgets/core/ButtonIconDropdown';

//
// SubAccountTree — renders the sub-account hierarchy as an expandable tree (nodes carry their own
// `children`). Each row indents by depth, shows an expand/collapse chevron when it has children, a status
// chip, and a per-row action menu. The parent owns the actions: it supplies `actionsFor(node)` (which
// actions apply to a given node) and `onAction(actionId, node)` (what to do). Purely presentational
// otherwise — no data fetching.
//
export function SubAccountTree( props : SubAccountTree.Props ) : JSX.Element
{
    const [expanded,setExpanded] = React.useState< Set<string> >( () => new Set() );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function toggle( id : string ) : void
    {
        setExpanded( ( prev : Set<string> ) =>
        {
            const next : Set<string> = new Set( prev );
            ( next.has( id ) ? next.delete( id ) : next.add( id ) );
            return next;
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function statusColor( status : Account.Status ) : "success" | "warning" | "error" | "default"
    {
        if( status === Account.Status.ACTIVE ) return "success";
        if( status === Account.Status.SUSPENDED || status === Account.Status.DISABLED || status === Account.Status.CANCELLED || status === Account.Status.DELETED ) return "error";
        return "warning";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one node row + its (collapsible) children, indented by depth
    function row( node : Account.SubAccount, depth : number ) : JSX.Element
    {
        const children    : Array<Account.SubAccount> = node.children ?? [];
        const hasChildren : boolean = children.length > 0;
        const open        : boolean = expanded.has( node.id );
        const actions     : Array<SubAccountTree.Action> = props.actionsFor( node );

        return  <Box key={ node.id }>
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", py: 0.75, pr: 1, pl: depth * 3, borderBottom: "1px solid", borderColor: "divider" }}>
                        { hasChildren
                            ? <ButtonIcon id={ `sub-toggle-${ node.id }` } label={ open ? "Collapse" : "Expand" } size="small"
                                          icon={ open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" /> }
                                          onClick={ () => toggle( node.id ) } />
                            : <Box sx={{ width: 34, flexShrink: 0 }} /> }
                        <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ node.name }</Typography>
                        <Chip size="small" variant="outlined" color={ statusColor( node.status ) } label={ node.status } />
                        { actions.length > 0 &&
                            <ButtonIconDropdown id={ `sub-actions-${ node.id }` } label={"Actions"} size="small"
                                                icon={ <MoreVertIcon fontSize="small" /> }
                                                choices={ actions.map( ( action : SubAccountTree.Action ) : ButtonIconDropdown.Choice => ( { value: action.id, label: action.label } ) ) }
                                                onChange={ ( value : string ) : void => props.onAction( value, node ) } /> }
                    </Stack>

                    { hasChildren &&
                        <Collapse in={ open } timeout="auto" unmountOnExit>
                            { children.map( ( child : Account.SubAccount ) => row( child, depth + 1 ) ) }
                        </Collapse> }
                </Box>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return <Box>{ props.nodes.map( ( node : Account.SubAccount ) => row( node, 0 ) ) }</Box>;
}

export namespace SubAccountTree
{
    export interface Action { id : string; label : string; }

    export interface Props
    {
        nodes      : Array<Account.SubAccount>;
        actionsFor : ( node : Account.SubAccount ) => Array<Action>;   // which actions apply to a node
        onAction   : ( actionId : string, node : Account.SubAccount ) => void;
    }
}

export default SubAccountTree;
// eof
