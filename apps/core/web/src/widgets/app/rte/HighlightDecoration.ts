//
// HighlightDecoration.ts
// A tiptap extension that renders regex matches as visual highlights
// using ProseMirror Decorations — never modifies the document, never resets cursor.
//
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

interface HighlightState
{
    regex   : RegExp | null;
    decorations : DecorationSet;
}

export const HIGHLIGHT_PLUGIN_KEY = new PluginKey<HighlightState>( 'highlightDecoration' );

export const HighlightDecoration = Extension.create( {
    name: 'highlightDecoration',

    addProseMirrorPlugins()
    {
        return [
            new Plugin( {
                key: HIGHLIGHT_PLUGIN_KEY,

                state: {
                    init() : HighlightState
                    {
                        return { regex: null, decorations: DecorationSet.empty };
                    },

                    apply( tr, prev ) : HighlightState
                    {
                        // Check if a new regex was dispatched via metadata
                        const meta : RegExp | null | undefined = tr.getMeta( HIGHLIGHT_PLUGIN_KEY );
                        if( meta !== undefined )
                        {
                            if( !meta ) return { regex: null, decorations: DecorationSet.empty };
                            return { regex: meta, decorations: buildDecorations( tr.doc, meta ) };
                        }

                        // Doc changed — rebuild from stored regex so new text is highlighted
                        if( tr.docChanged )
                        {
                            if( prev.regex )
                            {
                                return { regex: prev.regex, decorations: buildDecorations( tr.doc, prev.regex ) };
                            }
                            return { regex: null, decorations: DecorationSet.empty };
                        }

                        return prev;
                    }
                },

                props: {
                    decorations( state )
                    {
                        return HIGHLIGHT_PLUGIN_KEY.getState( state )?.decorations;
                    }
                }
            } )
        ];
    }
} );

function buildDecorations( doc : any, regex : RegExp ) : DecorationSet
{
    const decorations : Array<Decoration> = [];
    const re : RegExp = new RegExp( regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g' );

    doc.descendants( ( node : any, pos : number ) =>
    {
        if( !node.isText ) return;
        const text : string = node.text ?? '';
        let match : RegExpExecArray | null;
        re.lastIndex = 0;
        while( ( match = re.exec( text ) ) !== null )
        {
            const from : number = pos + match.index;
            const to   : number = from + match[0].length;
            decorations.push(
                Decoration.inline( from, to, { class: 'rte-highlight' } )
            );
        }
    } );

    return DecorationSet.create( doc, decorations );
}

export default HighlightDecoration;
// eof
