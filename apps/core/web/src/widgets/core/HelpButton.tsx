//
import React from 'react';
import { JSX } from "react";

import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';

//
import ButtonIcon   from './ButtonIcon';

import AppModel      from '@model/AppModel';
import PubSubService from '@model/service/PubSubService';


export function HelpButton( props: HelpButton.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    
    //////////////////////////////////////////////////////////////////////////////////////
    function onHelp() : void
    {
        appmodel.pubsub.publish( PubSubService.Type.HELP, props.url );
    }

    //
    //
    //
    return  <ButtonIcon id={ props.id } icon={ <HelpOutlineOutlinedIcon /> } label={ appmodel.ui.locale.label('common.button.help', {ellipse:true} ) } onClick={ onHelp } />;
}

/**
 * HelpButton component display a help icon when clicked will open the specific help information
 *
 * @param props.id - id of the compoent
 * @param props.url - url of the help document specififed in HelpLinks
 */
export namespace HelpButton
{
    export interface Props
    {
        id  : string;
        url : string;
    }
}

export default HelpButton;
// eof