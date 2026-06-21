//
// Responsive breakpoint hooks.
//
// These are React hooks (they call useMediaQuery/useTheme), so the usual rules apply:
// call them unconditionally at the TOP of a component, e.g.
//
//   const isMobile = useIsMobile();
//
// Do NOT call them inside conditionals, loops, callbacks, effects, or non-component
// functions - capture the value once at the top and reference that boolean instead.
//

import { useMediaQuery, useTheme } from '@mui/material';


//////////////////////////////////////////////////////////////////////////////////////////
/** True when the viewport width is below the theme's tablet breakpoint (i.e. mobile). */
export function useIsMobile() : boolean
{
    return useMediaQuery( useTheme().breakpoints.down('tablet') );
}

//////////////////////////////////////////////////////////////////////////////////////////
/** True when the viewport width is at or above the theme's tablet breakpoint. */
export function useIsTablet() : boolean
{
    return useMediaQuery( useTheme().breakpoints.up('tablet') );
}

//////////////////////////////////////////////////////////////////////////////////////////
/** True when the viewport width is at or above the theme's tablet/desktop breakpoint. */
export function useIsDesktop() : boolean
{
    return useMediaQuery( useTheme().breakpoints.up('tablet') );
}

// eof
