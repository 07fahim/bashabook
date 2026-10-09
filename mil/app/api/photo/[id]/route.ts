import { UUID } from '@/lib/auth';
import { db } from '@/lib/db';
import { photoOf } from '@/lib/photo';
import { currentMember } from '@/lib/session';

/** A flatmate's photo, only for someone signed in to the same flat. Each new photo has a new ?v=, so it can be cached for good. */
export async function GET(_req: Request, ctx: RouteContext<'/api/photo/[id]'>) {
  const { id } = await ctx.params;
  const me = await currentMember();
  const photo = me && UUID.test(id) ? await photoOf(db, me.flatId, id) : null;
  if (!photo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(photo), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' } });
}
