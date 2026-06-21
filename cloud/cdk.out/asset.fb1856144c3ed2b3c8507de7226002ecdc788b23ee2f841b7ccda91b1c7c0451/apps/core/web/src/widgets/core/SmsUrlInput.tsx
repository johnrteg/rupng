//
import React from 'react';
import { JSX } from "react";

import NewLabelOutlinedIcon         from '@mui/icons-material/NewLabelOutlined';

//
import Stack from '@mui/material/Stack';

import AppModel          from '@model/AppModel';

//
import SelectInput      from './SelectInput';
import UrlInput         from './UrlInput';
import SmsInput         from './SmsInput';
import ButtonIconDropdown from './ButtonIconDropdown';

enum Method
{
    HTTPS = "https",
    SMS = "sms"
}
//
//
export function SmsUrlInput( props: SmsUrlInput.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    
    const [method,setMethod]        = React.useState< string >( Method.HTTPS );
    const [url,setUrl]              = React.useState< string >( props.value );

    React.useEffect( propChanged, [props.value] );
    React.useEffect( urlChanged, [url] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function propChanged() : void
    {
        // parse init 
        if( props.value.toLowerCase().startsWith( "http" ) )
        {
            if( method !== Method.HTTPS )setMethod( Method.HTTPS );
        }
        else if( props.value.toLowerCase().startsWith( "sms" ) )
        {
            if( method !== Method.SMS )setMethod( Method.SMS );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function urlChanged() : void
    {
        if( props.onChange )props.onChange( url );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////
    function onAppendTag( value : string ) : void
    {
        setUrl( url + value );
    }

    // ======================================================================================================    
    return  <Stack direction="column" spacing={1.5} sx={ { width: "100%", boxSizing: "border-box" } } >
                <SelectInput    id={ props.id + "-sms-url" }
                                label={ "Source" }
                                disabled={ props.disabled }
                                sx={ { width: 100 } }
                                choices={ [ { value : Method.HTTPS, label : "HTTP/S (Web)" }, { value : Method.SMS, label : "SMS (Device)" } ] }
                                value={ method }
                                onChange={ setMethod } />

                { method === Method.HTTPS ? <Stack direction="row">
                                                <UrlInput id="https" label={"Web"} value={ url } onChange={ setUrl } />
                                                { props.tracking && props.tracking === true ? 
                                                <ButtonIconDropdown   id={'insert_tags'}
                                                                    label={ appmodel.ui.locale.label( 'page.tools.urlshortener.create.insert_tag' ) }
                                                                    icon={ <NewLabelOutlinedIcon/> }
                                                                    choices={[
                                                                    /*
                                                                    { value: "@first_name@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.first_name' ) },
                                                                    { value: "@last_name@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.last_name' )},
                                                                    { value: "@name@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.full_name' ) },
                                                                    { value: "@city@", label: appdata.ui.locale.label( 'common.address.city' )  },
                                                                    { value: "@county@", label: appdata.ui.locale.label( 'common.address.county' ) },
                                                                    { value: "@state@", label: appdata.ui.locale.label( 'common.address.state' ) },
                                                                    { value: "@zipcode@", label: appdata.ui.locale.label( 'common.address.zip' ) },
                                                                    { value: "@country@", label: appdata.ui.locale.label( 'common.address.country' ) },
                                                                    { value: "@url@", label: appdata.ui.locale.label( 'page.tools.urlshortener.create.url' ) },
                                                                    { value: "@icon@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.icon' ) },
                                                                    { value: "@source@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.source' ) },
                                                                    { value: "@descr@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.notes' ) },
                                                                    { value: "@question@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.question' )},
                                                                    { value: "@custom1@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.custom1' ) },
                                                                    { value: "@custom2@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.custom2' ) },
                                                                    { value: "@custom3@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.custom3' ) },
                                                                    { value: "@custom4@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.custom4' ) },
                                                                    { value: "@custom5@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.custom5' ) },
                                                                    { value: "@n@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.newline' )  },
                                                                    { value: "@cid@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.cid' ) },
                                                                    { value: "@campaign_name@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.org_id' ) },
                                                                    { value: "@num@", label:  appdata.ui.locale.label( 'page.tools.urlshortener.insert.project_num' ) },
                                                                    { value: "@action@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.project_id' ) },
                                                                    { value: "@user_name@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.texter_name' )  },
                                                                    { value: "@user_first_name@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.texter_first_name' ) },
                                                                    { value: "@user_designation@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.texter_desgination' ) },
                                                                    { value: "@user_state@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.texter_state' ) },
                                                                    { value: "@user_denonym@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.texter_denonym' ) },
                                                                    { value: "@account_name@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.user_name' ) },
                                                                    { value: "@account_firstname@", label: appdata.ui.locale.label( 'page.tools.urlshortener.insert.user_first_name' ) },
                                                                    */
                                                                    ]}
                                                                    onChange={ onAppendTag } /> : null }
                                            </Stack> :
                                            <SmsInput id="sms" label={"SMS"} value={ url } onChange={ setUrl } />}
            </Stack>
    
}

export namespace SmsUrlInput
{
    export interface Props
    {
        id              : string;
        label           : string;
        value           : string;
        tracking?       : boolean;
        disabled?       : boolean;
        onChange?       : ( new_value : string ) => void;
    }
}

export default SmsUrlInput;
// eof