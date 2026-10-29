import { UUID } from '@/lib/auth';
import { receiptOf } from '@/lib/bazar';
import { db } from '@/lib/db';
import { currentMember } from '@/lib/session';

/** A bazar's or bill's receipt photo, only for someone signed in to the same flat. A new photo has a new ?v=; a day's cache
 *  only, so a phone doesn't keep a purged receipt for long. */
export async function GET(_req: Request, ctx: RouteContext<'/api/receipt/[id]'>) {
  const { id } = await ctx.params;
  const me = await currentMember();
  const photo = me && UUID.test(id) ? await receiptOf(db, me.flatId, id) : null;
  if (!photo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(photo), { headers: { 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=86400' } });
}
