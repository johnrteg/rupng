//
import { JSX } from "react";

import { Box, Card, CardContent, CardHeader, Chip, Divider, Stack, Typography } from "@mui/material";
import VolumeUpOutlinedIcon from '@mui/icons-material/VolumeUpOutlined';

import { Access }   from '@repo/system';

import AuthPage     from '@widgets/app/AuthPage';

//
// Profile : Notifications — how the app notifies this user. Only the Audio notifications section exists
// for now (placeholder — the real controls land later); more sections (email, push, in-app) follow the
// same card style.
//
export function ProfileNotifications( props : ProfileNotifications.Props ) : JSX.Element
{
    return  <AuthPage minAccess={ Access.AccountRole.USER } title={"Profile : Notifications"}>
                <Box sx={{ p: 2, maxWidth: 880, mx: "auto" }}>

                    <Stack spacing={ 2 }>

                        {/* ── Audio notifications ──────────────────────────────────────────────── */}
                        <Card variant="outlined">
                            <CardHeader title={"Audio notifications"}
                                        subheader={"Play a sound when something needs your attention."}
                                        action={ <Chip size="small" variant="outlined" label={"Coming soon"} sx={{ mt: 1, mr: 1 }} /> } />
                            <Divider />
                            <CardContent>
                                <Stack direction="row" spacing={ 1.5 } sx={{ alignItems: "center" }}>
                                    <VolumeUpOutlinedIcon sx={{ color: "text.secondary" }} />
                                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                                        {"Choose a sound and when it plays. This is not yet available."}
                                    </Typography>
                                </Stack>
                            </CardContent>
                        </Card>

                    </Stack>
                </Box>
            </AuthPage>;
}

export namespace ProfileNotifications
{
    export interface Props
    {
    }
}

export default ProfileNotifications;
// eof
