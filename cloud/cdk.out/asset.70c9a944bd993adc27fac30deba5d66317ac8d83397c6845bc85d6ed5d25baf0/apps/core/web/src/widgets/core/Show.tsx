//
import React from 'react';
import { JSX } from "react";


export function Show( props : Show.Props ) : JSX.Element | null
{
    if (!props.show)
    {
        return props.fallback || null;
    }
    
    return <>{ props.children }</>;
}

export namespace Show
{
    export interface Props
    {
        show      : boolean;
        children  : JSX.Element | Array<JSX.Element>;
        fallback? : JSX.Element | null;
    }
}

export default Show;
// eof