//
import React from 'react';
import { JSX } from "react";

//
import EmojiPicker, { Theme, EmojiStyle } from 'emoji-picker-react';

//
import EmojiEmotionsOutlinedIcon from '@mui/icons-material/EmojiEmotionsOutlined';

//
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import { Popover } from '@mui/material';


export function EmojiButtonIconInput( props : EmojiButtonIconInput.Props ) : JSX.Element
{
    const [anchor, setAnchor]           = React.useState<null | HTMLElement>(null);
    const [disabled, setDisabled]       = React.useState< boolean >( props.disabled == undefined ? false : props.disabled );

    //
    React.useEffect( () => componentLoaded(), [] );
    React.useEffect( disabledChanged, [props.disabled] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {
        // these will likely come from the server...

    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function disabledChanged() : void
    {
        setDisabled( props.disabled == undefined ? false : props.disabled  );
        onClose();
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    function onClick( event: React.MouseEvent<HTMLButtonElement> ) : void
    {
        setAnchor( event.currentTarget );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onClose() : void
    {
        setAnchor( null );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onEmoji( selection : any ) : void
    {
        props.onChange( selection.emoji );
        onClose();
    }

    // ============================================================================================
    return  <section>
                <Tooltip title={ props.label } arrow={ true } >
                    <span>{/* -- neede when iconbutton is disabled -- */}
                        <IconButton disabled={ disabled } onClick={ ( event: React.MouseEvent<HTMLButtonElement> ) => onClick( event ) }>
                            { <EmojiEmotionsOutlinedIcon /> }
                        </IconButton>
                    </span>
                </Tooltip>

                { anchor ? <Popover
                                    open={ true }
                                    anchorEl={ anchor }
                                    onClose={ onClose }
                                    anchorOrigin={{
                                        vertical: 'top',    // show above the button
                                        horizontal: 'center',
                                    }}
                                    transformOrigin={{
                                        vertical: 'bottom', // popover's bottom aligns with button's top
                                        horizontal: 'center',
                                    }}
                                >
                    <EmojiPicker    onEmojiClick={ onEmoji }
                                    emojiStyle={ EmojiStyle.APPLE }
                                    theme={ Theme.AUTO } />
                </Popover> : null }
            </section>;

}

export namespace EmojiButtonIconInput
{
    export interface Props
    {
        id          : string;
        label       : string;
        disabled?   : boolean;
        onChange    : ( emoji: string ) => void;
    }
}


export default EmojiButtonIconInput;

// eof