# Google Analytics (app team only)

Counts visits to the live site. Set up 2026-10-27.

- Property **BashaBook** (account a280037957, Bangladesh time, Taka), web data stream **BashaBook website** for
  `https://bashabook.fahimfaiyaz.dev`, Measurement ID `G-HH4RWWQKFC` (public: it is in every page).
- Vercel env var `NEXT_PUBLIC_GA_ID` = that ID, type Config, **Production only**. It is read at build time: a change needs a
  production redeploy. Previews and local runs have no ID and load nothing.
- What the app sends (`app/[lang]/analytics.tsx`, `lib/analytics.ts`): one page view per address, the join code replaced by
  `code`, no query string (they carry member ids and months); the referrer cleaned the same way; Google signals and ad
  personalisation off.

## Must stay set in the GA admin

The code can only clean what it sends itself. Google's own extras read the real address, join code and `?m=` ids included.

- Admin, Data streams, BashaBook website, **Enhanced measurement: off** (set off when the stream was created). Never turn it
  back on: its history-based page views and form interactions would send the real address.
- Admin, Data collection: **Google signals off**. Admin, Data retention: 2 months is enough.

## Check after a deploy

Admin, DebugView or Reports, Realtime: open a join link, switch language, open Money. Every page should read `/en/j/code`,
`/bn/...`, `/en/money` with no code and no `?`.

## Reading it

Reports, Realtime for now; Reports, Engagement, Pages and screens for which pages; Reports, User attributes for countries
and devices. Real use (flats, people signed in, active this week) is in the database, not here.
