//
import React from 'react';
import { JSX } from "react";

//
import Box from '@mui/material/Box';

//
export function Pusher( props: Pusher.Props ) : JSX.Element
{
    return  <Box sx={ { flexGrow : 1 } } />;
}

export namespace Pusher
{
    export interface Props
    {
    }
}

export default Pusher;

// eof