//
//
// SchedulerTime — EventBridge Scheduler's `at(...)` expression wants a LOCAL-looking timestamp with no
// milliseconds/timezone suffix (`"2026-07-01T09:00:00"`), not a raw `Date#toISOString()`
// (`"2026-07-01T09:00:00.000Z"`). One tiny formatter so every `scheduler.upsert(...)` call agrees.
//
export function toSchedulerTimestamp( date : Date ) : string
{
    return date.toISOString().replace( /\.\d+Z$/, "" );
}

export default toSchedulerTimestamp;
// eof
