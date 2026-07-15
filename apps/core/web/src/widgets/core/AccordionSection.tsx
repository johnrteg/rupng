//
import React from 'react';
import { JSX } from "react";
import { Theme, useTheme } from '@mui/material/styles';

//import ReactGA from "react-ga4";

//
import { Accordion, AccordionDetails, AccordionSummary, Avatar, Typography } from '@mui/material';

import ExpandMoreIcon   from '@mui/icons-material/ExpandMore';

import BrowserUtils from '@utils/BrowserUtils';
import { useIsDesktop } from '../../utils/useBreakpoint';

//import Analytics        from '../utils/Analytics';


//

export function AccordionSection( props: AccordionSection.Props ) : JSX.Element
{

    const [selected,setSelected]   = React.useState< string | null >( props.selected );
    const theme : Theme = useTheme();
    const isDesktop : boolean = useIsDesktop();

    //
    React.useEffect( propsSelectedChanged, [props.selected] );
    React.useEffect( selectedChanged, [selected] );

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function selectedChanged() : void
    {
       // if( selected !== null && ( props.noReport === undefined || !props.noReport ) && appdata.cache.tracker )
       // {
            //ReactGA.send({ hitType: Analytics.Type.PAGE, page: window.location.pathname + "/section/" + selected });
       // }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onClick() : void
    {
        /// allow it to be toggled closed if clicked again
        props.onClick( props.selected !== props.id ? props.id : null );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function propsSelectedChanged() : void
    {
        setSelected( props.selected );
    }

    // ===============================================================================================================
    return  <Accordion  expanded={ selected === props.id }
                        sx={{
                            bgcolor: selected === props.id ? theme.palette.background.default : undefined // light primary when expanded
                            //bgcolor: selected === props.id ? (theme.palette.mode === 'dark' ? theme.palette.background.default: 'grey.100') : undefined // light primary when expanded
                        }}
                        onChange={ () => onClick() }>

                <AccordionSummary
                        expandIcon={ <ExpandMoreIcon />}
                        aria-controls={ props.id + "-content" }
                        id={ props.id + "-header" }
                        >

                    { props.value !== undefined ?
                    <Avatar sx={{ bgcolor: props.valueColor === undefined ? 'primary.main' : props.valueColor + '.main', width: 24, height: 24 }}>
                        { props.value }
                    </Avatar> :
                    null }
                    
                    <Typography component="span" sx={{ pl: props.value !== undefined ? 1 : 0, width: '33%', flexShrink: 0, fontWeight: 'bold' }}>
                        { props.primary }
                    </Typography>
          
                    { props.secondary && isDesktop ?
                    <Typography component="span" sx={{ width: props.tiercery !== undefined ? '33%' : '66%', flexShrink: 0, color: 'text.secondary' }}>
                        { props.secondary }
                    </Typography> : null }

                    { props.tiercery && isDesktop ?
                    <Typography component="span" sx={{ color: 'text.secondary' }}>
                        { props.tiercery }
                    </Typography> : null }

                    {/*{ props.action ? <section>{ props.action }</section> : null }*/}

                </AccordionSummary>
                <AccordionDetails sx={ { m:0, p: 0 } } >
                    { props.children }
                </AccordionDetails>
            </Accordion>;
}

////////////////////////////////////////////////////////////////////////////////////////////////
/**
 * Accordion control to segment parts of a view into sections that can be opened and closed.
 * No single accordion needs to be open (all can be closed), but if one is open, it is exclusive.
 *
 * @param id ID of the component
 * @param selected Section to be opened
 * @param value Optional value that would be placed in a small avatar.  This is typcally a number (to a string)
 * @param valueColor Optional method to set the background color of the "value" avatar.
 * @param primary Primary bolded label to the left
 * @param secondary OPtioanl secondary label near the center of the accordion bar
 * @param tiercery Optional third label to the right of the bar.
 * @param noReport Optional flag to not report of the selection to Google Analytics
 * @param onClick Callback when the section is selected.
 */
export namespace AccordionSection
{
    export interface Props
    {
        id          : string;
        selected    : string | null;
        
        value?      : string;
        valueColor? : 'primary' | 'error';

        primary     : string;
        secondary?  : string;
        tiercery?   : string | JSX.Element | null;
        noReport?   : boolean;
        children    : JSX.Element | Array<JSX.Element | null>;
        onClick     : ( id : string | null ) => void;
    }
}

export default AccordionSection;
// eof