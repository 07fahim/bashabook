import { db } from '@/lib/db';
import { authorized, runJobs } from '@/lib/jobs';
import { nowDhaka } from '@/lib/meals';

export const maxDuration = 25;   // cron-job.org gives up at 30 s

/** Called every 5 minutes by cron-job.org with the shared secret. Anything else gets 401 before any query. */
export async function GET(req: Request) {
  if (!authorized(req.headers.get('authorization'), process.env.CRON_SECRET)) return new Response(null, { status: 401 });
  const now = nowDhaka();
  const r = await runJobs(db, now);
  console.log('cron', now, JSON.stringify(r));
  return Response.json({ now, ...r });
}
