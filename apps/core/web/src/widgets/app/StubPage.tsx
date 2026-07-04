//
import { JSX } from "react";

import { Box, Typography } from '@mui/material';

import { Access }  from '@repo/system';
import AuthPage    from './AuthPage';

//
// StubPage — a placeholder destination for nav items whose real page isn't built yet. Renders inside the
// authenticated shell (nav + titled top bar) just like the dashboard, with a "coming soon" body, so the
// nav routes resolve to a real, consistent page during scaffolding.
//
export function StubPage( props : StubPage.Props ) : JSX.Element
{
    return  <AuthPage minAccess={ Access.AccountRole.USER } title={ props.title }>
                <Box sx={{ p: 3 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>{ props.title } — coming soon.</Typography>
                </Box>
            </AuthPage>;
}

export namespace StubPage
{
    export interface Props
    {
        title : string;
    }
}

export default StubPage;
