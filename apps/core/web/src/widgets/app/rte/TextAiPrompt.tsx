//
import React from 'react';
import { JSX } from "react";

//
// TextAiPrompt — the RTE "AI Assistant" dialog. CHAT IS COMMENTED OUT and will be RE-IMAGINED:
// the original implementation coupled to an AI-chat backend (GetAiChat / ChatGptChat) and app utilities
// (SysConstants, BetaChip, the AppData singleton) that don't exist in this repo. Until the chat feature is
// rebuilt, this renders nothing; the type contract (Format / Text / Props) is preserved so RichTextEditor
// keeps compiling and the AI button can be re-enabled without touching its call sites.
//
export function TextAiPrompt( _props : TextAiPrompt.Props ) : JSX.Element | null
{
    // chat disabled — to be re-imagined
    return null;
}

/* ============================================================================================================
 * ORIGINAL IMPLEMENTATION — commented out pending the re-imagined chat backend. Restore + rewire against the
 * new AI service when it lands (imports needed: an AI-chat endpoint, RestfulService from @repo/endpoint,
 * StringUtils from @repo/common, BrowserUtils/AppModel, and a replacement for SysConstants / BetaChip).
 *
 * export function TextAiPrompt( props : TextAiPrompt.Props ) : JSX.Element
 * {
 *     const appdata = AppData.instance();
 *     const [model,setModel]                  = React.useState( GetAiChat.Model.GPT4 );
 *     const [asking,setAsking]                = React.useState( false );
 *     const [stdPrompts,setStdPrompts]        = React.useState( [] );
 *     const [stdPrompt,setStdPrompt]          = React.useState( "" );
 *     const [format,setFormat]                = React.useState( TextAiPrompt.Format.PLAIN );
 *     const [formats,setFormats]              = React.useState( [] );
 *     const [prompt,setPrompt]                = React.useState( "" );
 *     const [plainText,setPlainText]          = React.useState( props.value.plain );
 *     const [htmlText,setHtmlText]            = React.useState( props.value.html ?? "" );
 *     const [plainResponse,setPlainResponse]  = React.useState( props.value.plain );
 *     const [htmlResponse,setHtmlResponse]    = React.useState( props.value.html ?? "" );
 *     const [error,setError]                  = React.useState( "" );
 *
 *     // effects: build the format choices, seed the standard prompts, ask the AI agent, and render an
 *     // AI Assistant dialog (common prompts + free prompt + original/response editors + copy-back).
 *     // The ask() built a GetAiChat.Request { cid, messages:[{role,content}], model } and posted to
 *     // GetAiChat.PATH via appdata.server.post(...), cleaning HTML with BrowserUtils.cleanHtml/stripHtml,
 *     // enforcing props.maxLength, and surfacing RestfulService.error(...) on failure.
 * }
 * ========================================================================================================== */

export namespace TextAiPrompt
{
    export enum Format
    {
        PLAIN = "plain",
        HTML = "html"
    }

    export interface Text
    {
        plain : string;
        html? : string;
    }

    export interface Props
    {
        value       : Text;
        formats     : Array<TextAiPrompt.Format>;
        maxLength?  : number;
        onClose     : () => void;
        onSaved     : ( new_text : Text, format : TextAiPrompt.Format ) => void;
    }
}



export default TextAiPrompt;

// eof
