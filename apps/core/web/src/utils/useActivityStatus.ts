//
// useActivityStatus — a React hook reporting whether the user is currently ACTIVE (recent mouse/keyboard/
// click/scroll input) or IDLE (no such input for `idleAfterMs`, default 5 minutes). Backs collab's presence
// signal (Collab.PresenceStatus.ACTIVE/IDLE) — see CollabSocketService, which sends this over the room
// socket's `presence.status` frame whenever it CHANGES (not continuously).
//
// This is a React hook (it calls useState/useEffect), so the usual rules apply: call it unconditionally at
// the TOP of a component.
//
import React from 'react';

const DEFAULT_IDLE_AFTER_MS : number = 5 * 60 * 1000;   // 5 minutes, matching the platform's default idle window

// the DOM events that count as "activity" — deliberately broad (mouse move/click, keyboard, scroll/touch)
const ACTIVITY_EVENTS : Array<string> = [ "mousemove", "mousedown", "keydown", "click", "scroll", "touchstart" ];

export type ActivityStatus = "active" | "idle";

//////////////////////////////////////////////////////////////////////////////////////////
/** @param idleAfterMs how long with no activity before flipping to "idle" (default 5 minutes). */
export function useActivityStatus( idleAfterMs : number = DEFAULT_IDLE_AFTER_MS ) : ActivityStatus
{
    const [status,setStatus] = React.useState< ActivityStatus >( "active" );

    React.useEffect( () : ( () => void ) => attachListeners( setStatus, idleAfterMs ), [ idleAfterMs ] );

    return status;
}

//////////////////////////////////////////////////////////////////////////////////////////
// attach the activity listeners + idle timer; returns the cleanup function React calls on unmount/re-run
function attachListeners( setStatus : ( status : ActivityStatus ) => void, idleAfterMs : number ) : () => void
{
    let timer : ReturnType<typeof setTimeout> | undefined;

    // any tracked event resets the idle timer and flips back to "active" immediately
    function onActivity() : void
    {
        setStatus( "active" );
        if( timer !== undefined ) clearTimeout( timer );
        timer = setTimeout( () : void => setStatus( "idle" ), idleAfterMs );
    }

    ACTIVITY_EVENTS.forEach( ( event : string ) : void => window.addEventListener( event, onActivity, { passive: true } ) );
    onActivity();   // start the timer immediately (a freshly-opened tab counts as active)

    return () : void =>
    {
        if( timer !== undefined ) clearTimeout( timer );
        ACTIVITY_EVENTS.forEach( ( event : string ) : void => window.removeEventListener( event, onActivity ) );
    };
}

// eof
