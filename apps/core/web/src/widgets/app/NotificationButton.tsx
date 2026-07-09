//
import { JSX } from "react";

import { Badge } from '@mui/material';
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined';

import AppModel from '@model/AppModel';
import ButtonIcon from '@widgets/core/ButtonIcon';

//
// NotificationButton — top-bar bell with an unread-count badge. Stubbed at 3 for now; clicking is a TODO
// (open a notifications panel/drawer). Sits to the left of the user menu.
//
export function NotificationButton( props : NotificationButton.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const count : number = props.count ?? 3;   // TODO: wire to real unread notifications

    function onClick() : void
    {
        // TODO: open the notifications panel/drawer
        appmodel.log.info( "notifications (stub)", { count } );
    }

    return  <ButtonIcon id="notifications" label="Notifications" color="inherit"
                        icon={ <Badge badgeContent={ count } color="error" overlap="circular">
                                   <NotificationsNoneOutlinedIcon />
                               </Badge> }
                        onClick={ onClick } />;
}

export namespace NotificationButton
{
    export interface Props
    {
        count? : number;   // unread count (defaults to the stub value)
    }
}

export default NotificationButton;
