//
import React from 'react';
import { JSX } from "react";

//
import IconButton       from '@mui/material/IconButton';
import Tooltip          from '@mui/material/Tooltip';
import Menu             from '@mui/material/Menu';
import MenuItem         from '@mui/material/MenuItem';
import Typography       from '@mui/material/Typography';
import Divider          from '@mui/material/Divider';
import ListItemIcon     from '@mui/material/ListItemIcon';
import { Theme, useTheme } from '@mui/material';

//

export function ButtonIconDropdown( props: ButtonIconDropdown.Props ) : JSX.Element
{
    const theme : Theme = useTheme();
    const [anchor, setAnchor]     = React.useState<null | HTMLElement>(null);
    const [disabled, setDisabled] = React.useState< boolean >( props.disabled != undefined ? props.disabled : false );

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
        event.stopPropagation();
        setAnchor( event.currentTarget );
    }

    ////////////////////////////////////////////////////////////////////////////////////
    function onClose( item : ButtonIconDropdown.Choice | null ) : void
    {
        if( item !== null )props.onChange( item.value );
        setAnchor( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////
    function onMenuClose( event: any, reason: "backdropClick" | "escapeKeyDown" ) : void
    {
        event.stopPropagation();
        onClose( null );
    }

    let btn_color : string = theme.palette.text.primary;   // auto
    if( props.mode !== undefined )
    {
        switch( props.mode )
        {
            case "light" : btn_color = theme.palette.primary.contrastText; break;
            case "dark"  : btn_color = theme.palette.background.default; break;
        }
    }

    return  <>
                <Tooltip title={ props.label } arrow={true} >
                    <section> {/* -- needed when iconbutton is disabled -- */}
                        <IconButton disabled={ disabled }
                                    size={ props.size != undefined ? props.size : "medium" }
                                    onClick={ ( event: React.MouseEvent<HTMLButtonElement> ) => onClick( event ) }
                                    sx={{  color : btn_color  }}>
                            { props.icon }
                        </IconButton>
                    </section>
                </Tooltip>

                { /* ----------------------------- popup menu when anchor is set from onClick ---------------------------- */ }
                { anchor ? <Menu
                                id={ props.id + "-menu-icon-dropdown" }
                                anchorEl={ anchor }
                                anchorOrigin={{ vertical: 'bottom', horizontal: 'left'  }}
                                keepMounted={ true }
                                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                                open={ true }
                                onClose={ onMenuClose } >

                { props.choices.map(( item: ButtonIconDropdown.Choice, index: number ) => (
                     item.divider ? <Divider key={ item.value } textAlign="left" >{ item.label !== "" ? <Typography variant="caption" color="primary">{ item.label }</Typography> : null }</Divider>
                                   :

                     <MenuItem  key={ item.value }
                                disabled={ item.disabled !== undefined ? item.disabled : false }
                                selected={ props.selected !== undefined && props.selected === item.value }
                                onClick={ () => onClose( item ) }>
                                
                        { item.icon !== undefined ?
                        <ListItemIcon>
                            { item.icon }
                        </ListItemIcon> : null }

                        <Typography sx={{ textAlign: 'left' }}>{ item.label }</Typography>
                    </MenuItem>

                ))}
                </Menu> : null }
            </>
            
}

export namespace ButtonIconDropdown
{
    export interface Choice
    {
        value       : string;
        label       : string;
        icon?       : JSX.Element;
        disabled?   : boolean;
        divider?    : boolean;
        data?       : any;      // optional caller payload carried alongside the choice
    }

    export interface Props
    {
        id        : string;
        icon      : JSX.Element;
        label     : string;
        choices   : Array<ButtonIconDropdown.Choice>;
        disabled? : boolean;
        selected? : string;
        size?     : "small" | "medium" | "large";
        mode?     : "auto" | "light" | "dark";
        onChange  : ( value : string ) => void;
    }
}


export default ButtonIconDropdown;

// eof