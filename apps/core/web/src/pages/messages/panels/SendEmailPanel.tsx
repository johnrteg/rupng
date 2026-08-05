import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';

import { Media, PostUpload, PostUploadComplete, PostEmailSend, Email } from '@repo/api';
import { RestfulService } from '@repo/endpoint';
import { EmailUtils, ByteUtils } from '@repo/common';

import SnackAlert       from '@widgets/core/SnackAlert';
import TextInput        from '@widgets/core/TextInput';
import EmailInput       from '@widgets/core/EmailInput';
import TagInput         from '@widgets/core/TagInput';
import FileInput        from '@widgets/core/FileInput';
import ButtonIconToggle from '@widgets/core/ButtonIconToggle';
import RichTextEditor   from '@widgets/app/rte/RichTextEditor';

// per-file attachment size cap — NOT appmodel.config.uploadLimits.maxFileBytes, which is a much smaller
// (~750KB), image-only limit meant for avatar/profile-image upload; a real email attachment (PDF, doc,
// a normal photo) routinely exceeds that, so reusing it silently dropped every non-trivial attachment
const MAX_ATTACHMENT_BYTES : number = 10_000_000;   // 10MB — comfortably under common provider message caps

// minimal extension → mime fallback for when the browser doesn't set File.type on an attachment
const MIME_BY_EXT : Record<string, string> =
{
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    pdf: "application/pdf", txt: "text/plain", csv: "text/csv", doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    zip: "application/zip",
};

//
// SendEmailPanel — the Email tab of Messages : Send. An ad-hoc compose-and-send tool (no template/campaign
// involved): gathers To/Cc/Bcc/From, subject, an RTE body, and optional attachments, uploads any attachments
// to the media service to get their asset guids, then enqueues the message via PostEmailSend. Sending is
// fire-and-forget from this panel's point of view — the send worker resolves/renders/delivers off-request;
// this panel only shows whether it was ACCEPTED. A sent message's delivery status is tracked in Messages : Sent.
//
export function SendEmailPanel( _props : SendEmailPanel.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [to,setTo]           = React.useState< Array<string> >( [] );
    const [cc,setCc]           = React.useState< Array<string> >( [] );
    const [bcc,setBcc]         = React.useState< Array<string> >( [] );
    const [showCc,setShowCc]   = React.useState< boolean >( false );   // Cc row toggle (button left of To)
    const [showBcc,setShowBcc] = React.useState< boolean >( false );   // Bcc row toggle (button left of To)
    const [from,setFrom]       = React.useState< string >( "" );
    const [subject,setSubject] = React.useState< string >( "" );
    const [html,setHtml]       = React.useState< string >( "" );
    const [files,setFiles]     = React.useState< Array<File> >( [] );
    const [sending,setSending] = React.useState< boolean >( false );
    const [snack,setSnack]     = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );

    // every address across the three fields must be a valid email; at least one recipient is required
    const addressesValid : boolean = [ ...to, ...cc, ...bcc ].every( ( address : string ) : boolean => EmailUtils.isValid( address ) );
    const fromValid       : boolean = from.trim() === "" || EmailUtils.isValid( from.trim() );
    const ready            : boolean = to.length > 0 && addressesValid && fromValid && !sending;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the mime for an attachment file — the browser's type, else guessed from the extension, else generic
    function mimeOf( file : File ) : string
    {
        if( file.type ) return file.type;
        const ext : string = ( file.name.split( "." ).pop() ?? "" ).toLowerCase();
        return MIME_BY_EXT[ ext ] ?? "application/octet-stream";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the presign → PUT bytes to S3 → complete handshake for one attachment, returning its media reference
    async function uploadAttachment( file : File ) : Promise<Email.Attachment | null>
    {
        const begin : RestfulService.Reply<PostUpload.Response> = await appmodel.server.fetch( new PostUpload( { filename: file.name, mime: mimeOf( file ), size: file.size, scope: Media.Scope.ACCOUNT } ) );
        if( !begin.ok || !begin.data ) return null;

        const put : RestfulService.Reply = await appmodel.server.put( begin.data.upload.url, null, file, { "Content-Type": mimeOf( file ) } );
        if( !put.ok ) return null;

        const done : RestfulService.Reply<PostUploadComplete.Response> = await appmodel.server.fetch( new PostUploadComplete( begin.data.asset.guid ) );
        if( !done.ok || !done.data ) return null;

        return { filename: file.name, assetGuid: done.data.asset.guid, contentType: mimeOf( file ) };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a rejected attachment used to fail silently (no chip, no feedback) — surface WHY it didn't attach
    function onAttachmentRejected( reason : FileInput.RejectionReason, file : File ) : void
    {
        const message : string = reason === FileInput.RejectionReason.SIZE
            ? `"${ file.name }" is too large (max ${ ByteUtils.toString( MAX_ATTACHMENT_BYTES ) } per file).`
            : `"${ file.name }" has an unsupported file type.`;
        setSnack( { message, severity: "warning" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a small text "icon" for the Cc/Bcc toggle — neither has a stock MUI glyph, so the label is the icon
    function letterIcon( text : string ) : JSX.Element
    {
        return <Typography variant="caption" sx={{ fontWeight: 600, lineHeight: 1 }}>{ text }</Typography>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // hide a channel's row AND clear its addresses — toggling off should drop any typed Cc/Bcc, not just hide it
    function onCcToggled( flag : boolean ) : void { setShowCc( flag ); if( !flag ) setCc( [] ); }
    function onBccToggled( flag : boolean ) : void { setShowBcc( flag ); if( !flag ) setBcc( [] ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function toRecipients( addresses : Array<string> ) : Array<Email.Recipient>
    {
        return addresses.map( ( email : string ) : Email.Recipient => ( { email } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // upload any attachments, then enqueue the send; on success reset the form for the next message
    async function onSend() : Promise<void>
    {
        setSending( true );

        // stage 1: any picked files → media assets → Email.Attachment refs (best-effort per file)
        const uploaded : Array<Email.Attachment> = [];
        for( const file of files )
        {
            const attachment : Email.Attachment | null = await uploadAttachment( file );
            if( attachment ) uploaded.push( attachment );
        }
        if( uploaded.length !== files.length )
        {
            setSending( false );
            setSnack( { message: "One or more attachments failed to upload.", severity: "error" } );
            return;
        }

        // stage 2: enqueue the send itself
        const sent : RestfulService.Reply<PostEmailSend.Response> = await appmodel.server.fetch( new PostEmailSend( {
            to:          toRecipients( to ),
            cc:          cc.length  > 0 ? toRecipients( cc )  : undefined,
            bcc:         bcc.length > 0 ? toRecipients( bcc ) : undefined,
            from:        from.trim() !== "" ? { email: from.trim() } : undefined,
            subject,
            html,
            attachments: uploaded.length > 0 ? uploaded : undefined,
        } ) );

        setSending( false );
        if( !sent.ok )
        {
            setSnack( { message: RestfulService.error( sent, "Could not send the email" ), severity: "error" } );
            return;
        }

        setSnack( { message: "Email queued for sending — track its status in Messages : Sent.", severity: "success" } );
        setTo( [] ); setCc( [] ); setBcc( [] ); setFrom( "" ); setSubject( "" ); setHtml( "" ); setFiles( [] );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <>
                <Box sx={{ p: 2, mx: "auto", maxWidth: 720, display: "flex", flexDirection: "column", gap: 2 }}>
                    <Card variant="outlined">
                        <CardHeader title={"Compose email"} subheader={"Send an ad-hoc email through the platform's email service"} />
                        <Divider />
                        <CardContent>
                            <Stack spacing={ 2 }>
                                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                                    <Box sx={{ flexGrow: 1 }}>
                                        <TagInput id="messages-send-to" label={"To"} value={ to } choices={ [] } allLowerCase noSpaces onTagValid={ EmailUtils.isValid } onChange={ setTo } />
                                    </Box>
                                    <ButtonIconToggle id="messages-send-toggle-cc"  label={ showCc  ? "Hide Cc"  : "Add Cc" }  icon={ letterIcon( "Cc" ) }  selected={ showCc }  onChange={ onCcToggled } />
                                    <ButtonIconToggle id="messages-send-toggle-bcc" label={ showBcc ? "Hide Bcc" : "Add Bcc" } icon={ letterIcon( "Bcc" ) } selected={ showBcc } onChange={ onBccToggled } />
                                </Stack>
                                { showCc  && <TagInput id="messages-send-cc"  label={"Cc"}  value={ cc }  choices={ [] } allLowerCase noSpaces onTagValid={ EmailUtils.isValid } onChange={ setCc } /> }
                                { showBcc && <TagInput id="messages-send-bcc" label={"Bcc"} value={ bcc } choices={ [] } allLowerCase noSpaces onTagValid={ EmailUtils.isValid } onChange={ setBcc } /> }
                                <EmailInput id="messages-send-from" label={"From (optional)"} value={ from } onChange={ setFrom } />
                                <TextInput id="messages-send-subject" label={"Subject"} value={ subject } onChange={ setSubject } />
                                <RichTextEditor id="messages-send-body" value={ html } minHeight={ 240 } onChange={ setHtml } />
                                <FileInput id="messages-send-attachments" type={ FileInput.Type.ATTACHMENT } label={"Attachments"}
                                           extensions={ [] } maxFiles={ 5 } maxSize={ MAX_ATTACHMENT_BYTES }
                                           onRejected={ onAttachmentRejected }
                                           value={ files } onChange={ setFiles } />

                                <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
                                    <Button variant="contained" disabled={ !ready }
                                            startIcon={ sending ? <CircularProgress size={ 16 } color="inherit" /> : <SendOutlinedIcon /> }
                                            onClick={ () => void onSend() }>
                                        { sending ? "Sending…" : "Send" }
                                    </Button>
                                </Stack>
                            </Stack>
                        </CardContent>
                    </Card>
                </Box>

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </>;
}

export namespace SendEmailPanel
{
    export interface Props {}
}

export default SendEmailPanel;
// eof
