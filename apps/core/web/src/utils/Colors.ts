//
import { Theme, useTheme } from '@mui/material';

export namespace Colors
{

    //
    // status methods that will map to a theme color
    // There is a limited number of pallette colors that can be used in this mapping.
    //
    /**
     * Colors.Status - predefined enumertion of status
     */
    export enum Status
    {
        PRIMARY     = "primary",
        INACTIVE    = "inactive",
        ERROR       = "error",
        ACTIVE      = "active",
        INWORK      = "inwork",
        PENDING     = "pending",
        // 1 more available is "secondary", but that is very close to the color error
    }

    ////////////////////////////////////////////////////////////////////////////////////////
   /**
    * Colors.bgColor returns the background color of the given status for the current theme.
    *
    * @param status Enumberated status type that will map to a give theme color
    * @param theme MUI theme to access current palette colors
    *
    * @return Returns the hex color value
    *
    */
    export function bgColor( status : Status, theme : Theme  ) : string
    {
        switch( status )
        {
            case Status.PRIMARY  : return theme.palette.primary.light; break;
            case Status.INACTIVE : return theme.palette.background.default; break;
            case Status.ERROR    : return theme.palette.error.light; break;
            case Status.ACTIVE   : return theme.palette.success.light; break;
            case Status.INWORK   : return theme.palette.info.light; break;
            case Status.PENDING  : return theme.palette.warning.light; break;
            default         : return theme.palette.background.default; break;
        }
    }

    //////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Colors.textColor returns the contrastring color for text in the background of Colors.bgColor.
    *
    * @param status Enumberated status type that will map to a give theme color
    * @param theme MUI theme to access current palette colors
    *
    * @return Returns the hex color value
    *
    */
    export function textColor( status : Status, theme : Theme  ) : string
    {
        switch( status )
        {
            case Status.PRIMARY  : return theme.palette.primary.contrastText; break;
            case Status.INACTIVE : return theme.palette.text.secondary; break;
            case Status.ERROR    : return theme.palette.error.contrastText; break;
            case Status.ACTIVE   : return theme.palette.success.contrastText; break;
            case Status.INWORK   : return theme.palette.info.contrastText; break;
            case Status.PENDING  : return theme.palette.warning.contrastText; break;
            default         : return theme.palette.text.secondary; break;
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////
    //
    // List of pre-defined alpha nex values
    //
    export const Alpha50 : string = "80";
    export const Alpha60 : string = "99";
    export const Alpha75 : string = "BF";

    ///////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Colors.addAlpha adds the alpha channel of a given array of hex value color
    *
    * @param colors Array of hex color to change the alpha channel to
    * @param alpha Alpha hex value to be set or added to the hex color.
    *
    * @return Returns the new array of colors with the alpha channel
    *
    */
    export function addAlpha( colors : Array<string>, alpha : string ) : Array<string>
    {
        return colors.map(color =>
            {
                return setAlpha( color, alpha );
            });
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Colors.setAlpha sets the alpha channel of a given hex value color
    *
    * @param color Hex color to change the alpha channel to
    * @param alpha Alpha hex value to be set or added to the hex color.
    *
    * @return Returns the new color with the alpha channel
    *
    * @example Colors.setAlpha( theme.palette.primary.contrastText, Colors.Alpha75 ) 
    */
    export function setAlpha( color : string, alpha : string ) : string
    {
        // if it already has an alpha channel, remove it
        if( color.length === 9 )
        {
            color = color.slice(0, 7);
        }
        return color + alpha;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // https://mui.com/material-ui/customization/color/
    // secondary
    // shade = 500
    /**
     * Colors.Charts - predefined chart palette (hex strings).
     *
     * @example
     * const first = Colors.Charts[0]; // '#3cb44b'
     */
    export const CHARTS : Array<string> = ['#3cb44b', '#e6194B', '#ffe119', '#4363d8', '#f58231',
    '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe',
    '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000',
    '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080'];


    export const DASHBOARD_CHARTS : Array<string> = ["#02a8b5","#e74c3c","#008037","#94D4D4","#f5b7b1","#80cd47"];
}

export default Colors;

// eof