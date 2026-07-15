import AppModel from "@model/AppModel";
//
import { JSX } from "react";

import { Box, Card, CardContent, CardHeader, Divider, Stack, Typography } from "@mui/material";
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';

import { Access } from '@repo/system';

import AuthPage from '@widgets/app/AuthPage';

//
// Help — support / docs surface (STUB). Will host searchable help articles, contact support, and product
// guides. Placeholder for now.
//
export function Help( props : Help.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.USER } title={"Help"}>
                <Box sx={{ p: 2, maxWidth: 900, mx: "auto" }}>
                    <Card variant="outlined">
                        <CardHeader title={"Help"} subheader={"Guides, docs, and support — coming soon."} />
                        <Divider />
                        <CardContent>
                            <Stack spacing={ 2 } sx={{ p: 4, alignItems: "center", textAlign: "center" }}>
                                <HelpOutlineOutlinedIcon sx={{ fontSize: 48, color: "text.disabled" }} />
                                <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Help content is on the way."}</Typography>
                            </Stack>
                        </CardContent>
                    </Card>
                </Box>
            </AuthPage>;
}

export namespace Help
{
    export interface Props {}
}

export default Help;
// eof
