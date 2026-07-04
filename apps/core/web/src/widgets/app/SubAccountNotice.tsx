import AppModel from "@model/AppModel";
//
import { JSX } from "react";

import { Alert } from "@mui/material";

//
// SubAccountNotice — a subtle info banner shown when the ACTING account is a sub-account (its membership
// carries a `parentName`). It names the parent so the user understands this record sits under another account
// that may control some of it (e.g. billing). Renders nothing for a top-level account. Reuse on any
// account-scoped page where parent context matters.
//
export function SubAccountNotice( props : SubAccountNotice.Props ) : JSX.Element | null
{
    const appmodel : AppModel = AppModel.instance();
    const parentName : string | undefined = appmodel.account.current?.parentName;
    if( !parentName ) return null;

    return  <Alert severity="info" variant="outlined">
                { `This is a sub-account of ${ parentName }. ${ props.detail ?? "Some settings may be managed by the parent account." }` }
            </Alert>;
}

export namespace SubAccountNotice
{
    export interface Props
    {
        detail? : string;   // what the parent may control on this page (e.g. "Billing may be managed by the parent account.")
    }
}

export default SubAccountNotice;
// eof
