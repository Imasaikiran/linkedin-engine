# sai-voice (demo profile)

This is the public demo profile. Its traces are public. To make your own voice,
copy the template and edit it:

    cp -r examples/_template examples/my-voice

Then run:

    pnpm pipeline --profile examples/my-voice

`brand.yaml` is the single source of truth: your role, your banned phrases, your
weekly cadence. Edit that file, not the engine.

The `voice-corpus/external/` folder holds plain-text samples of writing in this
voice. The drafter pulls a few each run to stay on key. Drop `.txt` files there.
