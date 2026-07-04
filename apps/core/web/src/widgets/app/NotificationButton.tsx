//
import { JSX } from "react";

import { Badge, IconButton, Tooltip } from '@mui/material';
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined';

import AppModel from '@model/AppModel';

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

    return  <Tooltip title="Notifications">
                <IconButton color="inherit" onClick={ onClick }>
                    <Badge badgeContent={ count } color="error" overlap="circular">
                        <NotificationsNoneOutlinedIcon />
                    </Badge>
                </IconButton>
            </Tooltip>;
}

export namespace NotificationButton
{
    export interface Props
    {
        count? : number;   // unread count (defaults to the stub value)
    }
}

export default NotificationButton;
