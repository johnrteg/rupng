//
// Trace now lives in @repo/common (browser-safe; shared by services AND the web app). Re-exported
// here so existing `@repo/services` and relative `./Trace` imports — named and default — keep working.
//
import { Trace } from "@repo/common";

export { Trace };
export default Trace;
