//
import { Context } from "aws-lambda";
import type { Browser } from "puppeteer-core";

import { SvgDocument } from "@repo/api";

import MediaJob from "./MediaJob";
import { SvgRenderPipeline } from "../pipeline/SvgRenderPipeline";

//
// SvgRenderJob — the Lambda counterpart to MediaMainService's in-process svg-render consumer (SVG_EDITOR_SPEC
// §10). Decouples Puppeteer/Chromium's CPU/memory footprint from the API traffic MediaMainService also
// serves, and scales with queue depth instead of being capped by one process/one browser. Runs the exact
// same SvgRenderPipeline.runRenderJob as the MAIN consumer — only how the browser is launched differs
// (Lambda-compatible Chromium here vs. the full bundled `puppeteer` there).
//
export class SvgRenderJob extends MediaJob<unknown, void>
{
    private _browser? : Browser;

    /////////////////////////////////////////////////////////////////////
    constructor() { super( "svgRender" ); }

    /////////////////////////////////////////////////////////////////////
    // lazily launch (once per warm execution environment) the Lambda-compatible headless Chromium —
    // puppeteer-core + @sparticuz/chromium, NOT the full `puppeteer` package MediaMainService uses (its
    // bundled Chromium download is too large/incompatible for a Lambda deployment package)
    private async browser() : Promise<Browser>
    {
        if( this._browser === undefined )
        {
            const chromium = await import( "@sparticuz/chromium" );
            const puppeteerCore = await import( "puppeteer-core" );
            const executablePath : string = await chromium.default.executablePath();
            this._browser = await puppeteerCore.launch( { args: chromium.default.args, executablePath, headless: true } );
        }
        return this._browser;
    }

    /////////////////////////////////////////////////////////////////////
    // parse the `{ jobId, accountId, projectId, pageIds, settings }` refs SvgService.queueRenderJob sends to
    // the svg-render queue — a different payload shape than the scan/process jobs' `mediaRefs()`, so it gets
    // its own small parser rather than reusing that one
    private svgRenderRefs( event : unknown ) : Array<{ jobId : string; accountId : string; projectId : string; pageIds : Array<string> | null; settings : SvgDocument.ExportSettings }>
    {
        const records : Array<{ body? : string }> = ( event as { Records? : Array<{ body? : string }> } )?.Records ?? [];
        const refs : Array<{ jobId : string; accountId : string; projectId : string; pageIds : Array<string> | null; settings : SvgDocument.ExportSettings }> = [];
        for( const record of records )
        {
            try
            {
                const parsed : any = JSON.parse( record.body ?? "{}" ) as { jobId? : string; accountId? : string; projectId? : string; pageIds? : Array<string> | null; settings? : SvgDocument.ExportSettings };
                if( parsed.jobId && parsed.accountId && parsed.projectId && parsed.settings )
                    refs.push( { jobId: parsed.jobId, accountId: parsed.accountId, projectId: parsed.projectId, pageIds: parsed.pageIds ?? null, settings: parsed.settings } );
            }
            catch { /* skip a malformed record */ }
        }
        return refs;
    }

    /////////////////////////////////////////////////////////////////////
    public async handler( event : unknown, _context : Context ) : Promise<void>
    {
        // `puppeteer`'s Browser type (what SvgRenderPipeline expects) is a re-export of puppeteer-core's —
        // the exact same declaration, so this needs no cast even though the two packages differ at runtime
        const browser : Browser = await this.browser();
        for( const ref of this.svgRenderRefs( event ) )
            await SvgRenderPipeline.runRenderJob( await this.pipelineDeps(), browser, ref.jobId, ref.accountId, ref.projectId, ref.pageIds, ref.settings );
    }
}

//
// Lambda entrypoint — manifest `jobs.svgRender`, handler "jobs/SvgRenderJob.handler".
//
const job : SvgRenderJob = new SvgRenderJob();
export const handler = ( event : unknown, context : Context ) : Promise<void> => job.invoke( event, context );

export default SvgRenderJob;
// eof
