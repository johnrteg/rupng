//
import React from "react";
import { JSX } from "react";

import AppModel from "@model/AppModel";
import PubSubService from "@model/service/PubSubService";


export function Subscriber( props : Subscriber.Props ) : JSX.Element | null
{
    const appdata : AppModel = AppModel.instance();

    // state
    const [value,setValue]           = React.useState< number >( 0 );
    const value_ref                  = React.useRef< number >( 0 );
    const event_ref                  = React.useRef< PubSubService.Event | null >( null);

    //
    React.useEffect( () => componentLoaded(), [] );
    React.useEffect( () => ()=> componentUnLoaded(), [] );
    React.useEffect( valueChanged, [value] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {
        appdata.pubsub.addSubscriber( props.event, onSubscribe );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function componentUnLoaded() : void
    {
        appdata.pubsub.removeSubscriber( props.event, onSubscribe );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    function valueChanged() : void
    {
        // avoid the fist call to this when initilized
        if( value > 0 )
        {
            if( props.onChange )props.onChange( event_ref.current );
            if( props.onChangeSync )props.onChangeSync( event_ref.current );
        }
        value_ref.current = value;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onSubscribe( event : PubSubService.Event ) : void
    {
        // to get around the issue of react lockin on callbacks
        // hold it until the next rendering cycle and then notify
        event_ref.current = event;
        setValue( value_ref.current + 1 );
    }
    
    //
    //
    //
    return null;
}

////////////////////////////////////////////////////////////////////////////////////////////////
/**
 * Subscribes to a published event.  Changes to the the event topic will call the onChange callback.
 * The event is subscribed to when component is instantiated and un-subscribed when it goes out of scope.
 * This is a renderless component, so placement in your rendering section can be arbitrary.
 *
 * @param event Unique event identifier / subject / topic.
 * @param onChange Callback when the event notification occurs.
 */
export namespace Subscriber
{
    export interface Props
    {
        event   : string;
        onChange? : ( event : PubSubService.Event ) => void;
        onChangeSync? : ( event : PubSubService.Event ) => Promise<void>;
    }
}

export default Subscriber;
// eof