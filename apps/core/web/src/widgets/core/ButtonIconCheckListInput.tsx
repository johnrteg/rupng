//
import React from 'react';
import { JSX } from "react";

//
import IconButton       from '@mui/material/IconButton';
import Tooltip          from '@mui/material/Tooltip';
import List             from '@mui/material/List';
import { Checkbox, ListItem, ListItemButton, ListItemIcon, ListItemText, Popover } from '@mui/material';





export function ButtonIconCheckListInput( props: ButtonIconCheckListInput.Props ) : JSX.Element
{
    const [anchor, setAnchor]       = React.useState<null | HTMLElement>(null);
    const [disabled, setDisabled]   = React.useState< boolean >( props.disabled != undefined ? props.disabled : false );
    const [checked, setChecked]     = React.useState< Array<string> >( props.value );

    //
    React.useEffect( disabledChanged, [props.disabled] );

    ////////////////////////////////////////////////////////////////////////////////////
    function disabledChanged() : void
    {
        setDisabled( props.disabled != undefined ? props.disabled : false );
    }

    ////////////////////////////////////////////////////////////////////////////////////
    function onClick( event : React.MouseEvent<HTMLButtonElement> ) : void
    {
        setAnchor( event.currentTarget  );
    }

    ////////////////////////////////////////////////////////////////////////////////////
    function onClose() : void
    {
        //if( item )props.onChange( item.value );
        setAnchor( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////
    function onSelection( id : string ) : void
    {
        let new_checked : Array<string>;

        // Remove if already checked
        if( checked.includes( id ) )
        {   
            new_checked = checked.filter(item => item !== id);
        }
        else    // Add if not checked
        {
            new_checked = [ ...checked, id ];
        }

        // make certain changes still meet minimum number of selections
        if( new_checked.length >= props.minChecked )
        {
            setChecked( new_checked );
            props.onChange( new_checked );
        }
        
    }

    return  <section>
                <Tooltip title={ props.label } arrow={true} >
                    <IconButton disabled={ disabled } onClick={ ( event: React.MouseEvent<HTMLButtonElement> ) => onClick( event ) }>
                        { props.icon }
                    </IconButton>
                </Tooltip>

                { /* ----------------------------- popup menu when anchor is set from onClick ---------------------------- */ }
                { anchor ?
                    <Popover
                        open={ true }
                        anchorEl={ anchor }
                        onClose={ onClose }
                        anchorOrigin={{
                                            vertical: 'bottom',    // show above the button
                                            horizontal: 'center',
                                        }}
                        transformOrigin={{
                                            vertical: 'top', // popover's bottom aligns with button's top
                                            horizontal: 'center',
                                        }}
                        >

                    <List dense={ true } sx={{ p:0, bgcolor: 'background.paper' }}>
                        { props.choices.map( ( item : ButtonIconCheckListInput.Item, index: number ) =>
                        {
                            return  <ListItem key={ item.value } id={ item.value } sx={ { px: 0 } }>
                                        <ListItemButton role={undefined} onClick={ () => onSelection( item.value ) } dense>
                                            <ListItemIcon sx={{ minWidth: 32, mr: 0 }}>
                                                <Checkbox
                                                        edge="start"
                                                        checked={ checked.includes( item.value ) }
                                                        tabIndex={-1}
                                                        disableRipple
                                                        sx={{ py: 0.5, px: 1 }} 
                                                />
                                            </ListItemIcon>

                                            <ListItemText   id={ item.value }
                                                            sx={{ my: 0, py: 0 }}
                                                            primary={ item.label } />
                                            
                                        </ListItemButton>
                                    </ListItem>
                        } ) }
                    </List>
                </Popover>
                : null }
            </section>
            
}


//
export namespace ButtonIconCheckListInput
{
    export interface Item
    {
        value       : string;
        label       : string;
    }

    export interface Props
    {
        id          : string;
        icon        : JSX.Element;
        label       : string;
        choices     : Array<ButtonIconCheckListInput.Item>;
        disabled?   : boolean;
        value       : Array<string>;
        minChecked  : number;
        onChange    : ( checked : Array<string> ) => void;
    }
}



export default ButtonIconCheckListInput;
// eof