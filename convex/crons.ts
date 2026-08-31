import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Reap sessions past their expiry so a dead refresh token doesn't sit in the
// table indefinitely. Runs hourly; a busier-than-expected sweep just catches
// up on the next run rather than blocking anything.
crons.interval("reap expired sessions", { hours: 1 }, internal.sessions.reapExpired, {});

export default crons;
