# Voice profile template

Copy this directory, rename it, and edit `brand.yaml`. Three things to change first:

1. `identity.role` - what you do, one line.
2. `voice.must_not_have.banned_phrases` - words you never use.
3. `cadence.{mon,wed,fri}.pillar` - what kind of post each day is.

The defaults for everything else are sane. Run with:

    pnpm pipeline --profile examples/your-folder

Drop plain-text samples of your writing into `voice-corpus/external/` so the
drafter can stay on key.
