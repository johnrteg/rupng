import AppModel from "@model/AppModel";
//
import { JSX } from "react";

import { Box, Card, CardContent, CardHeader, Divider, Stack, Typography } from "@mui/material";
import BrushOutlinedIcon from '@mui/icons-material/BrushOutlined';

import { Access } from '@repo/system';

import AuthPage from '@widgets/app/AuthPage';

//
// Media : Studio — the creation & editing surface (media-21, STUB). Will host the SVG/asset editor: compose
// and edit media into new library assets (reusing the media plane, AI generation, and the async Jobs). Served
// by the media STUDIO role. Placeholder until the editor is built.
//
export function MediaStudio( props : MediaStudio.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.USER } title={"Media : Studio"}>
                <Box sx={{ p: 2, mx: "auto" }}>
                    <Card variant="outlined">
                        <CardHeader title={"Studio"} subheader={"Compose and edit media — coming soon."} />
                        <Divider />
                        <CardContent>
                            <Stack spacing={ 2 } sx={{ p: 4, alignItems: "center", textAlign: "center" }}>
                                <BrushOutlinedIcon sx={{ fontSize: 48, color: "text.disabled" }} />
                                <Typography variant="body1">{"The Studio editor is on the way."}</Typography>
                                <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 520 }}>
                                    {"Design and edit on an SVG canvas, pull in library assets and AI-generated media, then save the result back to your library."}
                                </Typography>
                            </Stack>
                        </CardContent>
                    </Card>
                </Box>
            </AuthPage>;
}

export namespace MediaStudio
{
    export interface Props {}
}

export default MediaStudio;
// eof
