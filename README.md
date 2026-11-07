# Pigeongram

Pigeongram is an independent, unofficial Telegram web client that keeps your conversations available in a fast,
installable web app. It supports QR sign-in, chats and threads, live updates, media, search, comments, voice calls
between Pigeongram users, and an offline app shell.

Pigeongram is not affiliated with Telegram Messenger LLP. “Pigeongram” is the product name; Telegram-related names in
the repository are implementation identifiers or descriptions of the service.

## Try it

The project is currently in active development. The core application is implemented, but a production deployment still
needs Telegram API credentials and Cloudflare Access configuration. See the [deployment guide](docs/DEPLOYMENT.md) if
you are setting up an instance.

## Useful commands

```bash
pnpm run checks:fast  # typecheck, lint, formatting, and repository checks
pnpm run test         # unit tests
pnpm run build        # build all packages
```

## Documentation

- [Deployment guide](docs/DEPLOYMENT.md) — Cloudflare setup, secrets, first deploy, and Android builds
- [Session engine](docs/SESSION_ENGINE.md) — backend architecture and acceptance runbook
- [Progressive web app](docs/PWA.md) — installability, offline behavior, and service-worker checks
- [AGENTS.md](AGENTS.md) — repository architecture, invariants, conventions, and contributor guidance

## License

See the repository license file for the terms that apply to this project.
