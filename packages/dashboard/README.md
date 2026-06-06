# site

The public website for linkedin-engine, built with Next.js.

- `/` is the marketing landing page: what it does, how it works, and how to run it.
  It needs no database and shows no run stats.
- `/dashboard` is an optional, unlinked run-health page: publish rate, cost per run,
  and the last 10 runs with trace links. It reads from Supabase. It is for someone
  who self-hosts and wants an at-a-glance health page for their own runs. It is not
  in the site nav, because the public landing page is marketing, not anyone's stats.

## Local

```bash
cp .env.local.example .env.local   # only needed for /dashboard
pnpm --filter @linkedin-engine/dashboard dev
# http://localhost:3001        (landing)
# http://localhost:3001/dashboard   (run health, if Supabase env is set)
```

## Deploy to Vercel

```bash
cd packages/dashboard
vercel deploy
```

The landing page needs no environment variables. For `/dashboard`, set:

- `SUPABASE_URL` - your project URL
- `SUPABASE_ANON_KEY` - the public anon key (Settings -> API). The page reads via the
  row-level-security public-read policy, so the anon key is the right one and is safe
  to expose. There is no service_role fallback. Do NOT use the service_role key here.

The pages revalidate every 60 seconds.
