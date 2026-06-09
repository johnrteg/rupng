import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";


import Page         from "@pages/common/Page";
import { Access }   from "@repo/endpoint";

export function Dashboard( props : Dashboard.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    
    //
    React.useEffect( () => componentLoaded(), [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // when this is loaded, it means all of its children have loaded already
    function componentLoaded() : void
    {

    
    }

    return <Page minAccess={ Access.AccountRole.USER }>
    </Page>;
}

export namespace Dashboard
{
    export interface Props
    {
    }
}
// eof