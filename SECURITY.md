# Security

## Reporting a vulnerability

Open a GitHub security advisory (Security tab -> Report a vulnerability) or email
the maintainer. Do not open a public issue for a security report.

## Secrets

This repo never commits secrets. API keys live in `.env` (gitignored) locally and
in GitHub Actions repository secrets in CI. The public Langfuse trace for the demo
profile exposes node names, token counts, and cost only. It never exposes the body
of a draft that was skipped.
