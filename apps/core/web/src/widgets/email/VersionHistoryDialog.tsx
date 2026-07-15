import AppModel from "@model/AppModel";
import LocaleService from "@model/service/LocaleService";
//
import { JSX } from "react";

import { Chip, Stack, Typography } from "@mui/material";
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import RestoreOutlinedIcon    from '@mui/icons-material/RestoreOutlined';

import { EmailTemplate } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import ButtonIcon   from '@widgets/core/ButtonIcon';

//
// VersionHistoryDialog — lists a template's saved versions (newest first) with the current one marked. Each row
// can PREVIEW that version's compiled HTML (in the editor's preview drawer) or RESTORE it (the parent confirms
// then reverts). The version bodies live immutably in S3 (email-2.7); this reads the log off the entity.
//
export function VersionHistoryDialog( props : VersionHistoryDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    // newest version first
    const ordered : Array<EmailTemplate.VersionInfo> = [ ...props.versions ].sort( ( left : EmailTemplate.VersionInfo, right : EmailTemplate.VersionInfo ) : number => right.version - left.version );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // format a saved-at timestamp via the house locale service (never toLocaleString)
    function when( savedAt : string ) : string
    {
        return appmodel.ui.locale.dateTime( new Date( savedAt ), LocaleService.Format.MEDIUM ) || "";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // close the dialog (used by the single Done action)
    async function onDone() : Promise<boolean>
    {
        props.onClose();
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="tpl-version-history" title={"Version history"} yesLabel={"Done"} minWidth="sm" onYes={ onDone } onClose={ props.onClose }>
                <Stack spacing={ 1 }>
                    { ordered.length === 0 && <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No saved versions yet."}</Typography> }
                    { ordered.map( ( info : EmailTemplate.VersionInfo ) : JSX.Element => (
                        <Stack key={ info.version } direction="row" spacing={ 1 } sx={{ alignItems: "center", px: 1, py: 0.5, borderRadius: 1,
                                bgcolor: info.version === props.currentVersion ? "action.selected" : "transparent" }}>
                            <Typography variant="body2" sx={{ width: 56, fontWeight: 600 }}>{ `v${ info.version }` }</Typography>
                            <Chip size="small" variant="outlined" label={ info.status } />
                            <Typography variant="caption" sx={{ color: "text.secondary", flexGrow: 1 }}>{ when( info.savedAt ) }</Typography>
                            { info.version === props.currentVersion && <Chip size="small" color="primary" label={"Current"} /> }
                            <ButtonIcon id={ `ver-preview-${ info.version }` } label={"Preview"} size="small" icon={ <VisibilityOutlinedIcon fontSize="small" /> } onClick={ () => props.onPreview( info.version ) } />
                            <ButtonIcon id={ `ver-restore-${ info.version }` } label={"Restore"} size="small" disabled={ info.version === props.currentVersion } icon={ <RestoreOutlinedIcon fontSize="small" /> } onClick={ () => props.onRestore( info.version ) } />
                        </Stack>
                    ) ) }
                </Stack>
            </DialogWindow>;
}

export namespace VersionHistoryDialog
{
    export interface Props
    {
        versions       : Array<EmailTemplate.VersionInfo>;
        currentVersion : number;
        onPreview      : ( version : number ) => void;   // show that version's compiled HTML in the preview drawer
        onRestore      : ( version : number ) => void;   // restore that version (parent confirms + reverts)
        onClose        : () => void;
    }
}

export default VersionHistoryDialog;
// eof
