//
import { JSX } from "react";

import PubSubService from '@model/service/PubSubService';
import Subscriber    from '@widgets/core/Subscriber';

//
// AccountChange — drop into any account-scoped page so it reacts when the acting account changes (a switch
// from the account switcher / sub-accounts). It listens for the ACCOUNT pubsub event and runs a two-phase
// refresh: `onClear` first (wipe the old account's data so nothing stale lingers while loading), then
// `onRefresh` (re-fetch for the NEW account and repopulate). Renders nothing. Every account-scoped view
// should mount one — the account context (X-Account) is already switched by the time the event fires, so
// `onRefresh`'s server calls return the new account's data.
//
export function AccountChange( props : AccountChange.Props ) : JSX.Element
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    // acting account changed → clear the view, then refresh it for the new account
    function onAccount() : void
    {
        props.onClear();
        void Promise.resolve( props.onRefresh() );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return <Subscriber event={ PubSubService.Type.ACCOUNT } onChange={ onAccount } />;
}

export namespace AccountChange
{
    export interface Props
    {
        onClear   : () => void;                    // wipe account-scoped view state (runs first)
        onRefresh : () => void | Promise<void>;    // re-fetch data for the new account (runs after clear)
    }
}

export default AccountChange;
// eof
