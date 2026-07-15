import React from 'react';
import { JSX } from "react";

import { Stack } from "@mui/material";

import DialogWindow from '@widgets/core/DialogWindow';
import TextInput    from '@widgets/core/TextInput';
import TagInput     from '@widgets/core/TagInput';

import { StudioProject } from '@repo/api';

//
// StudioProjectDialog — edit a Studio project's PROPERTIES: its name and its tags. Opened from the project
// banner's gear button. The parent owns open/close + persistence (`onSave` returns true to close); the dialog
// owns its own form state, seeded from the project passed in.
//
export function StudioProjectDialog( props : StudioProjectDialog.Props ) : JSX.Element
{
    const [name,setName] = React.useState< string >( props.project.name );
    const [tags,setTags] = React.useState< Array<string> >( props.project.tags ?? [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // save on confirm — hand the trimmed name + tags back to the parent (which persists + closes)
    async function onYes() : Promise<boolean>
    {
        const trimmed : string = name.trim();
        if( trimmed === "" ) return false;
        return props.onSave( trimmed, tags );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="studio-project-properties"
                          title={"Project Properties"}
                          yesLabel={"Save"}
                          cancelLabel={"Cancel"}
                          minWidth="xs"
                          ready={ name.trim() !== "" }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <TextInput id="studio-project-name" label={"Name"} value={ name } onChange={ setName } maxLength={ 100 } fullWidth />
                    <TagInput id="studio-project-tags" label={"Tags"} value={ tags } choices={ [] } onChange={ setTags } />
                </Stack>
            </DialogWindow>;
}

export namespace StudioProjectDialog
{
    export interface Props
    {
        project : StudioProject.Entity;                                   // the project being edited (seeds the form)
        onSave  : ( name : string, tags : Array<string> ) => Promise<boolean>;   // save; true = close
        onClose : () => void;
    }
}

export default StudioProjectDialog;
// eof
