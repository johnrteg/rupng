//
import React from 'react';
import { JSX } from "react";

//
import { Divider, ListItemIcon, Menu, MenuItem, Typography } from '@mui/material';
import MenuBarButton from './MenuBarButton';


export function MenuBarButtonDropdown( props : MenuBarButtonDropdown.Props ) : JSX.Element
{
    const [anchor, setAnchor]     = React.useState<null | HTMLElement>(null);

    ///////////////////////////////////////////////////////////////////////////////////////
    function onClick( event : React.MouseEvent<HTMLButtonElement>) : void
    {
        //event.stopPropagation();
        setAnchor( event.currentTarget );
    }

    ////////////////////////////////////////////////////////////////////////////////////
    function onClose( item : MenuBarButtonDropdown.Choice | null ) : void
    {
         if( item )props.onClick( item.value );
        setAnchor( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onClickStub() : void
    {
    }

    // ============================================================================================
    return  <section>
                <MenuBarButton  id={props.id}
                                label={props.label}
                                icon={props.icon}
                                disabled={ props.disabled }
                                onClick={onClickStub}
                                onClickRaw={onClick}
                                selected={ false } />

                { /* ----------------------------- popup menu when anchor is set from onClick ---------------------------- */ }
                { anchor ? <Menu
                                    id={ props.id + "-menu-icon-dropdown" }
                                    anchorEl={ anchor }
                                    anchorOrigin={{ vertical: 'bottom', horizontal: 'left'  }}
                                    keepMounted
                                    transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                                    open={ true }
                                    onClose={ () => onClose( null ) } >

                    { props.choices.map(( item: MenuBarButtonDropdown.Choice, index: number ) => (
                        item.divider ? <Divider key={ item.value } textAlign="left" >{ <Typography color="primary">{ item.label }</Typography> }</Divider> :

                        <MenuItem  key={ item.value }
                                    disabled={ item.disabled !== undefined ? item.disabled : false }
                                    selected={ item.selected !== undefined && item.selected }
                                    onClick={ () => onClose( item ) }>
                                    
                            { item.icon !== undefined ?
                            <ListItemIcon>
                                { item.icon }
                            </ListItemIcon> : null }

                            <Typography sx={{ textAlign: 'left' }}>{ item.label }</Typography>
                        </MenuItem>

                    ))}
                </Menu>
                : null }
            </section>

}

export namespace MenuBarButtonDropdown
{
    export interface Choice
    {
        value       : string;
        label       : string;
        divider?    : boolean;
        disabled?   : boolean;
        icon?       : JSX.Element;
        selected?   : boolean;
    }

    export interface Props
    {
        id          : string;
        label       : string;
        icon        : JSX.Element;
        choices     : Array<Choice>;
        disabled?   : boolean;
        onClick     : ( value : string ) => void;
    }
}

export default MenuBarButtonDropdown;

// eof