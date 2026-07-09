//
import React from 'react';
import { JSX } from "react";

//
import { Theme, useTheme } from '@mui/material';
import MenuBarButton from './MenuBarButton';


export function MenuBarPopupButton( props : MenuBarPopupButton.Props ) : JSX.Element
{
    const theme : Theme = useTheme();

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onClick( event: React.MouseEvent<HTMLButtonElement>  ) : void
    {
        props.onClick( event.currentTarget );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onClickStub() : void
    {
    }

    // ============================================================================================
    return <MenuBarButton   id={props.id}
                            label={props.label}
                            icon={props.icon}
                            disabled={ props.disabled }
                            onClick={onClickStub}
                            onClickRaw={onClick}
                            selected={ props.selected } />
}

export namespace MenuBarPopupButton
{
    export interface Props
    {
        id          : string;
        label       : string;
        icon        : JSX.Element;
        selected    : boolean;
        disabled?   : boolean;
        onClick     : ( anchor: null | HTMLElement ) => void;
    }
}

export default MenuBarPopupButton;
// eof