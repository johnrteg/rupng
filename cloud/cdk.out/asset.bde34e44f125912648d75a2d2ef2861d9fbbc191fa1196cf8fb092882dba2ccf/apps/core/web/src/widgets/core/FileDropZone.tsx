//
import React from 'react';
import { JSX } from "react";

//
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack, Typography } from "@mui/material";

// icons
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';


import AppModel          from '@model/AppModel';

import ErrorMessage     from "./ErrorMessage";
import Pusher           from "./Pusher";
import { ByteUtils, StringUtils, ValueUtils } from '@repo/common';



export function FileDropZone( props: FileDropZone.Props ) : JSX.Element
{
    const appmodel       : AppModel = AppModel.instance();
    
    const [dragActive, setDragActive]       = React.useState< boolean >(false);
    const [selectedFiles, setSelectedFiles] = React.useState< Array<File> | null >( null );
    const [error, setError]                 = React.useState< string >("");
    const [disabled, setDisabled]           = React.useState< boolean >( props.disabled !== undefined ? props.disabled : false );

    const inputRef                          = React.useRef<HTMLInputElement>(null);

    React.useEffect( filesChanged, [selectedFiles] );
    React.useEffect( disabledChanged, [props.disabled] );

    /////////////////////////////////////////////////////////////////////////
    function filesChanged() : void
    {
        if( selectedFiles !== null )props.onChange( selectedFiles );
    }

    /////////////////////////////////////////////////////////////////////////
    function disabledChanged() : void
    {
        setDisabled( props.disabled !== undefined ? props.disabled : false );
    }

    ////////////////////////////////////////////////////////////////////////////////////
    function validateFiles( files: FileList)  : File[] | null
    {
        let valid : Array<File> = [];
        if( props.maxFiles && files.length > props.maxFiles )
        {
            setError( `You can only upload up to ${props.maxFiles} file(s).`);
            return null;
        }
        
        let i : number;
        const n : number = files.length;

        for( i = 0; i < n; i++ )
        {
            const file : File = files[i];
            const ext : string  | undefined = file.name.split(".").pop()?.toLowerCase();
            if (    props.allowedExtensions
                    && props.allowedExtensions.length > 0
                    && ( !ext || !props.allowedExtensions.includes(ext))
                )
            {
                setError( `File "${file.name}" has an invalid extension. Allowed: ${ props.allowedExtensions.join( ", " )}` );
                return null;
            }
            if( props.maxSize && file.size > props.maxSize )
            {
                setError(`File "${file.name}" exceeds the maximum size of ${ ByteUtils.toString( props.maxSize ) }.` );
                return null;
            }
            valid.push( file );
        }
        setError( "" );
        return valid;
    }

    /////////////////////////////////////////////////////////////////////////
    function onFiles( files: FileList ) : void
    {
        const valid = validateFiles(files);
        if( valid )setSelectedFiles(valid);
    }

    /////////////////////////////////////////////////////////////////////////
    function onDrop( e: React.DragEvent<HTMLDivElement> ) : void
    {
        e.preventDefault();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0)
        {
            onFiles(e.dataTransfer.files);
        }
    }

    /////////////////////////////////////////////////////////////////////////
    function onChange( e: React.ChangeEvent<HTMLInputElement> ) : void
    {
        if (e.target.files && e.target.files.length > 0)
        {
            onFiles( e.target.files );
        }
    }

    /////////////////////////////////////////////////////////////////////////
    function onClick( evt: React.MouseEvent<HTMLElement> ) : void
    {
        evt.stopPropagation();
        inputRef.current?.click();
    }

    /////////////////////////////////////////////////////////////////////////
    function onClear( evt: React.MouseEvent<HTMLElement> ) : void
    {
        evt.stopPropagation();
        setSelectedFiles( [] );
    }

    /////////////////////////////////////////////////////////////////////////
    function onDragOver( evt: React.DragEvent<HTMLDivElement> ) : void
    {
        evt.preventDefault();
        setDragActive(true);
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onDragLeave( evt: React.DragEvent<HTMLDivElement> ) : void
    {
        setDragActive( false );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function directionsMessage() : string
    {
        return StringUtils.format( "Drag and drop file{0} here, or", props.maxFiles && props.maxFiles > 1 ? "s" : "" );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function allowedMessage() : string
    {
        let msg : string = StringUtils.format( "Allowed: {0}", props.allowedExtensions && props.allowedExtensions.length > 0 ? props.allowedExtensions.join(", ") : "any" );
        let max : string = StringUtils.format( "Max size: {0}", props.maxSize ? ByteUtils.toString( props.maxSize ) : "Any" );
        let size : string = StringUtils.format( "Max files: {0}", props.maxFiles ? props.maxFiles : "any" );
        return [msg, max, size].join( ", " );
    }

    //
    //
    //
    let frame : JSX.Element =
        <Box
            onDragOver={ onDragOver }
            onDragLeave={ onDragLeave }
            onDrop={ onDrop }
            sx={{
                border: "2px dashed",
                borderColor: dragActive ? "primary.main" : "grey.400",
                borderRadius: 2,
                p: 3,
                textAlign: "center",
                bgcolor: dragActive ? "grey.100" : "background.paper",
                cursor: "pointer",
                transition: "border-color 0.2s",
            }}
            onClick={ onClick }
        >
            <input
                ref={ inputRef }
                type="file"
                multiple={ props.maxFiles ? props.maxFiles > 1 : true }
                style={{ display: "none" }}
                accept={ props.allowedExtensions && props.allowedExtensions.length > 0 ? props.allowedExtensions.map( ext => "." + ext).join(",") : undefined }
                onChange={ onChange }
                disabled={ disabled }
            />

            <Stack direction="column" sx={{alignItems:"center"}} spacing={0.5}>
                <CloudUploadOutlinedIcon color="primary" sx={{ fontSize: 62 }} />
                <Typography     variant="body1" sx={{ mb: 1 }}>{ directionsMessage() }</Typography>
                <Button         variant="outlined" onClick={ onClick } disabled={ disabled }>{ "Browse" }</Button>
                <Typography     variant="caption" sx={{color:"text.secondary"}}>{ allowedMessage() }</Typography>
                <ErrorMessage value={ error } />
            </Stack>
            
            { selectedFiles !== null && selectedFiles.length > 0 && (
                <Stack direction="column"  sx={{ mt: 2, alignItems:"center" }}>
                    { selectedFiles.map((file) => (
                        <Typography key={file.name} variant="body2">
                            { file.name } ( { ByteUtils.toString( file.size, 2 ) } )
                        </Typography>
                    ))}

                    <Stack direction="row" sx={{ mt: 2, alignItems:"center" }} spacing={2} >
                        <Button id="upload" variant="outlined" sx={{ mt: 2 }} onClick={ onClear } disabled={ disabled } >
                            { "Clear" }
                        </Button>
                        {/*}
                        <Button id="upload" variant="contained" sx={{ mt: 2 }} onClick={ onUpload } disabled={ uploading } >
                            { "Upload" }
                        </Button>
                        */}
                    </Stack>
                    
                </Stack>
            )}

        </Box>

        // ............................................................................................
        // if dialog
        if( ValueUtils.notUndefined( props.dialog ) && props.dialog )
        {
            frame = <Dialog open={true} fullWidth={ false }>
                <DialogTitle id="upload-title">{ props.title }</DialogTitle>
                <Divider />
                <DialogContent>
                        { frame }
                </DialogContent>
                <Divider />
                <DialogActions>
                    <Pusher />
                    <Button variant="outlined" onClick={ props.onClose } >{ appmodel.ui.locale.label( 'common.button.close' ) }</Button>
                </DialogActions>
            </Dialog>
        }

        return frame;

}

export namespace FileDropZone
{
    export interface Props
    {
        title               : string;
        maxFiles?           : number;
        allowedExtensions?  : string[]; // e.g. ['csv', 'xlsx']
        maxSize?            : number;
        dialog?             : boolean;
        disabled?           : boolean;
        onChange            : ( files: Array<File> ) => void;
        //onUpload            : ( files: Array<File> ) => Promise<void>;
        //onComplete          : () => void;
        onClose?             : () => void;
    }
}


export default FileDropZone;
// eof