//
import React from 'react';
import { JSX } from "react";

//
import { IconButton, Theme, Tooltip, useTheme } from '@mui/material';


export function MenuBarButton( props : MenuBarButton.Props ) : JSX.Element
{
    const theme : Theme = useTheme();

    ///////////////////////////////////////////////////////////////////////////////////////
    function onClick( event : React.MouseEvent<HTMLButtonElement>) : void
    {
        event.stopPropagation();
        if( props.onClick )props.onClick();
        if( props.onClickRaw )props.onClickRaw( event );
    }
    
    // ============================================================================================
    return  <Tooltip title={ props.label } arrow>
                <section>
                <IconButton
                        id={ props.id }
                        disabled={ props.disabled }
                        onClick={ onClick }
                        sx={{
                            minWidth: 0,
                            padding: 0.5,
                            width: 40,
                            height: 40,
                            borderRadius: 0.5,
                            lineHeight: 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            bgcolor: props.selected ? ( theme.palette.mode === 'light' ? theme.darken( theme.palette.divider, 0.5 ) : theme.lighten( theme.palette.divider, 0.5 ) ) : "transparent",
                            border: "1px solid",
                            borderColor: ( theme.palette.mode === 'light' ? theme.darken( theme.palette.divider, 0.5 ) : theme.lighten( theme.palette.divider, 0.5 ) ),
                            color: theme.palette.text.secondary,
                            boxShadow: "none",
                            '&:hover': {
                                bgcolor: ( theme.palette.mode === 'light' ? theme.darken( theme.palette.divider, 0.25 ) : theme.lighten( theme.palette.divider, 0.25 ) ),
                                boxShadow: "none",
                            },
                        }}
                    >
            {props.icon}
            </IconButton>
            </section>
        </Tooltip>;

}

export namespace MenuBarButton
{
    export interface Props
    {
        id          : string;
        label       : string;
        icon        : JSX.Element;
        selected    : boolean;
        disabled?   : boolean;
        onClick?    : () => void;
        onClickRaw? : ( event : React.MouseEvent<HTMLButtonElement> ) => void;
    }
}

export default MenuBarButton;

// eof