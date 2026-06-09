//
import React from 'react';
import { JSX } from "react";

//
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';

//

export function ButtonIcon( props: ButtonIcon.Props ) : JSX.Element
{
    const [disabled,setDisabled]   = React.useState< boolean >( props.disabled != undefined ? props.disabled : false );

    //
    React.useEffect( disabledChanged, [props.disabled] );

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function disabledChanged() : void
    {
        setDisabled( props.disabled != undefined ? props.disabled : false );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onClick( evt : React.MouseEvent<HTMLButtonElement> ) : void
    {
        //evt.preventDefault();
        evt.stopPropagation();
        props.onClick();
    }

    return  <Tooltip title={ props.label } arrow={true} >
                    <section>
                    <IconButton key={ props.id }
                                disabled={ disabled }
                                size={ props.size != undefined ? props.size : "medium" }
                                onClick={ onClick } >
                        { props.icon }
                    </IconButton>
                    </section>
            </Tooltip>
            ;
}


export namespace ButtonIcon
{
    export interface Props
    {
        id          : string;
        icon        : JSX.Element;
        label       : string;
        disabled?   : boolean;
        size?       : "small" | "medium" | "large";
        onClick     : () => void;
    }
}


export default ButtonIcon;

// eof