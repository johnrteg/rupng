//
import React from 'react';
import { JSX } from "react";

//
import { Box, IconButton } from '@mui/material';

// icons
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import AttachFileOutlinedIcon from '@mui/icons-material/AttachFileOutlined';

import BrowserUtils         from "@utils/BrowserUtils";

import ChipInput            from "./ChipInput";
import { ByteUtils, StringUtils } from '@repo/common';


//
//
//
export function FileInput( props : FileInput.Props ) : JSX.Element
{
    const [chips,setChips]                  = React.useState< Array<ChipInput.Item> >( [] );

    const fileInputRef                      = React.useRef<HTMLInputElement>(null);
    const existingChipAdded                 = React.useRef< boolean >( false );

    //
    React.useEffect( filesPropsChanged, [props.value] );
    React.useEffect( existingFileChanged, [props.existingFileUrl] )
    React.useEffect( chipsChanged, [chips] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function filesPropsChanged() : void
    {
        if( props.value !== undefined )
        {
            const current_files : Array<File> = chips.filter( ( chip : ChipInput.Item ) => !chip.readonly ).map( ( chip : ChipInput.Item ) => chip.data as File);
            if( BrowserUtils.filesAreSame( props.value, current_files ) ) return;   // no updates

            const newChips = props.value.map((file : File, index : number ) => (
                {
                    value: index.toString(),
                    label: StringUtils.format("{0} ({1})", file.name, ByteUtils.toString(file.size)),
                    data: file
                })
            );
            setChips( newChips );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function existingFileChanged() : void
    {
        if( !props.existingFileUrl || existingChipAdded.current ) return;

        existingChipAdded.current = true;

        const filename : string = props.existingFileUrl.split('/').pop()?.split('?')[0] ?? props.existingFileUrl;

        setChips( [ {
            value : "0",
            label : filename,
            data  : null as unknown as File,
            readonly : true,
        } ] );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onUpload() : void
    {
        if( fileInputRef.current )
        {
            fileInputRef.current.value = ""; // reset so same file can be picked again
            fileInputRef.current.click();
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function chipsChanged() : void
    {
        // convert chips to files, exlcude existing chip since that is a string url
        const files : Array<File> = chips.filter( ( chip : ChipInput.Item ) => !chip.readonly ).map( ( chip : ChipInput.Item ) => chip.data as File );
        props.onChange(files);
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onFileChange( event: React.ChangeEvent<HTMLInputElement> ) : void
    {
        const files_list : FileList | null = event.target.files;
        if( !files_list )return;

        // validate & let user know of file rejections
        let picked_files : Array<File> = Array.from( files_list ).filter( ( file : File ) => {
            const extension      : string  | undefined = file.name.split('.').pop()?.toLowerCase();
            const validExtension : boolean = props.extensions.length === 0 || ( !!extension && props.extensions.map( ( extension : string ) => extension.toLowerCase() ).includes( extension ) );
            const validSize      : boolean = props.maxSize !== undefined ? file.size <= props.maxSize : true;

            if( !validExtension ) props.onRejected?.( FileInput.RejectionReason.EXTENSION, file );
            else if( !validSize ) props.onRejected?.( FileInput.RejectionReason.SIZE, file );

            return validExtension && validSize;
        } );

        // Limit to maxFiles
        if( props.maxFiles > 0 )
        {
            picked_files = picked_files.slice( 0, props.maxFiles );
        }

        // create and keep files with chips
        const new_chips : Array<ChipInput.Item> = picked_files.map((file : File, index : number ) => (
            {
                value   : index.toString(),
                label   : StringUtils.format("{0} ({1})", file.name, ByteUtils.toString(file.size)),
                data    : file
            }));

        setChips( new_chips );

        //setFiles( picked_files );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( new_value : Array<ChipInput.Item> ) : void
    {
        const removedExisting : boolean = chips.some( ( chip : ChipInput.Item ) => chip.readonly )
                                  && !new_value.some( ( chip : ChipInput.Item ) => chip.readonly );
        if( removedExisting ) props.onExistingFileRemoved?.();
        setChips( new_value );
    }

    //
    //
    return <Box sx={{ width: "100%", boxSizing: "border-box" }}>
                <input
                    ref={ fileInputRef }
                    type="file"
                    style={{ display: 'none' }}
                    multiple={ props.maxFiles > 1 }
                    accept={ props.extensions.length > 0 ? props.extensions.map( ext => '.' + ext).join(',') : undefined }
                    onChange={ onFileChange }
                />

                <ChipInput id={ props.id }
                            label={ props.label }
                            backgroundColor={ props.backgroundColor }
                            startIcon={ <IconButton onClick={ () => onUpload() }> { props.type == FileInput.Type.UPLOAD ? <UploadFileOutlinedIcon /> : <AttachFileOutlinedIcon /> }</IconButton> }
                            value={ chips }
                            onChange={ onChange } />
            </Box>;

}

export namespace FileInput
{

    export enum Type
    {
        ATTACHMENT = "attachment",
        UPLOAD = "upload"
    }

    export enum RejectionReason
    {
        SIZE        = "size",
        EXTENSION   = "extension"
    }

    //
    //
    //
    export interface Props
    {
        id                  : string;
        type                : FileInput.Type;
        label               : string;
        value?              : Array<File>;
        existingFileUrl?    : string;
        extensions          : Array<string>;
        maxFiles            : number;
        maxSize?            : number;
        backgroundColor?    : string;
        onRejected?         : ( reason: FileInput.RejectionReason, file: File ) => void;
        onExistingFileRemoved? : () => void;
        onChange            : ( value : Array<File> ) => void;
    }

}

export default FileInput;

// eof