//
import React from 'react';
import { JSX } from "react";

//
import { List, ListItem, ListItemIcon, ListItemText } from '@mui/material';
import TextLabel from './TextLabel';




//
//
//
export function ListInput( props : ListInput.Props ) : JSX.Element
{

    //
    //
    //
    return <List dense={ props.dense ?? true }>

            { props.items.map( ( item : ListInput.Item, index : number ) =>
                { return <ListItem key={index}>
                            <ListItemIcon sx={{ minWidth: 32, mr: 0, ml: 0, p: 0 }}>
                                { item.icon ?? null }
                            </ListItemIcon>
                            <ListItemText primary={ <TextLabel  variant="body2"
                                                                bold={ item.bold }
                                                                strikethru={ item.strikethru ? item.strikethru : false }
                                                                value={ item.label } /> }
                                            secondary={ item.lowerLabel ?? null }
                            />
                            </ListItem> } ) }

            </List>;

}

export namespace ListInput
{
    export interface Item
    {
        id          : string;
        label       : string;
        icon?       : JSX.Element;
        lowerLabel? : string;
        bold?       : boolean;
        strikethru? : boolean;
    }

    //
    //
    //
    export interface Props
    {
        dense?: boolean;
        items : Array<ListInput.Item>;
    }
}

export default ListInput;

// eof