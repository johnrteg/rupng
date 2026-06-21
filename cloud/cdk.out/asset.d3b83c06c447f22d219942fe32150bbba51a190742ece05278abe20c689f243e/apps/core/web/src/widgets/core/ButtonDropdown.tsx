//
import React from 'react';
import { JSX } from "react";

//
import Menu             from '@mui/material/Menu';
import MenuItem         from '@mui/material/MenuItem';
import Typography       from '@mui/material/Typography';
import Button           from '@mui/material/Button';
import ListItemIcon     from '@mui/material/ListItemIcon';


//
import KeyboardArrowDownOutlinedIcon from '@mui/icons-material/KeyboardArrowDownOutlined';
import { Divider } from '@mui/material';


//

export function ButtonDropdown( props: ButtonDropdown.Props ) : JSX.Element
{
    const [anchor, setAnchor]     = React.useState<null | HTMLElement>(null);

    ////////////////////////////////////////////////////////////////////////////////////
    function onClick( event : React.MouseEvent<HTMLButtonElement> ) : void
    {
        setAnchor( event.currentTarget  );
    }

    ////////////////////////////////////////////////////////////////////////////////////
    function onClose( item : ButtonDropdown.Choice | null ) : void
    {
        if( item )props.onChange( item.value );
        setAnchor( null );
    }

    return  <section>
                <Button id={ props.id }
                        variant={ props.variant != undefined ? props.variant : "contained"}
                        startIcon={ props.icon ?? props.icon }
                        endIcon={ <KeyboardArrowDownOutlinedIcon /> }
                        sx={{ whiteSpace: 'nowrap', px: 3 }}
                        disabled={ props.disabled ?? props.disabled }
                        onClick={ onClick }
                        >{ props.label }
                </Button>
                { anchor ? <Menu
                        id="menu-icon-dropdown"
                        anchorEl={ anchor }
                        anchorOrigin={{ vertical: 'bottom', horizontal: 'left'  }}
                        keepMounted
                        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                        open={ true }
                        onClose={ () => onClose( null ) } >
                { props.choices.map(( item: ButtonDropdown.Choice, index: number ) => (
                     
                     <section key={ 'sect-' + item.value }>
                        { item.divider !== undefined ? <Divider key={ 'menu-div-' + item.value } textAlign="left">{ <Typography color="primary" variant="caption">{item.label}</Typography> }</Divider>
                        : 
                        <MenuItem key={ 'menu-item-' + item.value } onClick={ () => onClose( item ) }>
                            { item.icon ? <ListItemIcon key={ "icon_" + item.value } >{ item.icon }</ListItemIcon> : null }
                            <Typography key={ 'label-' + item.value } sx={{ textAlign: 'left' }}>{ item.label }</Typography>
                        </MenuItem> }
                     </section>
                     
                ))}
                </Menu> : null }
            </section>
            
}

export namespace ButtonDropdown
{
    export interface Choice
    {
        value       : string;
        label       : string;
        divider?    : boolean;
        icon?       : JSX.Element;
    }

    export interface Props
    {
        id        : string;
        label     : string;
        icon?     : JSX.Element;
        disabled? : boolean;
        variant?  : "contained" | "outlined";
        choices   : Array<ButtonDropdown.Choice>;
        onChange  : ( id : string ) => void;
    }
}


export default ButtonDropdown;

// eof