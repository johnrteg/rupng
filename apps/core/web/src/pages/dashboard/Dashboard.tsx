//
import { JSX } from "react";

import { Box, Typography } from "@mui/material";

import { Access }  from "@repo/endpoint";
import AuthPage    from "../../widgets/app/AuthPage";

//
// Dashboard — the authenticated landing page. (Passkey enrolment now lives on Profile : Security.)
//
export function Dashboard( props : Dashboard.Props ) : JSX.Element
{
    return  <AuthPage minAccess={ Access.AccountRole.USER } title={"Dashboard"}>
                <Box sx={{ p: 3 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Welcome back."}</Typography>
                </Box>
            </AuthPage>;
}

export namespace Dashboard
{
    export interface Props
    {
    }
}
// eof
