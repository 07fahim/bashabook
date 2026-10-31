import { confirmEmail } from '@/lib/auth';
import { db } from '@/lib/db';
import { hasLocale } from '../../dictionaries';

/** The link in the confirmation email: confirms that address, then says so on /confirm. A mail scanner opening it only
 *  proves the mail reached that inbox, which is all a confirmation means. */
export async function GET(request: Request, ctx: RouteContext<'/[lang]/confirm/[token]'>) {
  const { lang, token } = await ctx.params;
  const ok = await confirmEmail(db, token);
  return Response.redirect(new URL(`/${hasLocale(lang) ? lang : 'en'}/confirm?ok=${ok ? 1 : 0}`, request.url), 303);
}
