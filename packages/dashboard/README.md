# dashboard

A read-only Next.js page showing run health from Supabase: publish rate, cost per
run, and the last 10 runs with trace links. Per DESIGN section 8.

## Local

```bash
cp .env.local.example .env.local   # add your Supabase URL + anon key
pnpm --filter @linkedin-engine/dashboard dev
# http://localhost:3001
```

## Deploy to Vercel

```bash
cd packages/dashboard
vercel deploy
```

Set two environment variables in the Vercel project:

- `SUPABASE_URL` - your project URL
- `SUPABASE_ANON_KEY` - the public anon key (Settings -> API). The dashboard reads
  via the row-level-security public-read policy, so the anon key is the right one
  and is safe to expose. The dashboard reads ONLY this key; there is no
  service_role fallback. Do NOT use the service_role key here.

The page revalidates every 60 seconds.
