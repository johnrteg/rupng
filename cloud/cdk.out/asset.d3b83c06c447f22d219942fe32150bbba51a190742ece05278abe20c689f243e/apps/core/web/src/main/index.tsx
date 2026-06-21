//


////
//
import * as React from "react";
import { createRoot, Root } from 'react-dom/client';

// for dashboard drag of items
// filepath: /Users/johntegen/development/rumbleup-react/client/src/index.tsx
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

// fonts
import '@fontsource/roboto/300.css'; // Light
import '@fontsource/roboto/400.css'; // Regular
import '@fontsource/roboto/500.css'; // Medium
import '@fontsource/roboto/700.css'; // Bold

import AppModel  from "@model/AppModel";
import App      from "./App";



// singleton
const appdata : AppModel = AppModel.instance();
appdata.initialize( () => main() );

//
// main entry point to set the base react app to the element in the HTML
//
function main() : void
{
    const container : HTMLElement = document.getElementById('root') as HTMLElement;
    const root : Root = createRoot( container! );
    root.render( <App /> );
    //root.render( <React.StrictMode><App /></React.StrictMode>);
}
