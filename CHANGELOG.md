# Changelog

All notable changes to `@luniq/node` are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-04-27

### Added
- Initial public release.
- `new Luniq({ apiKey, endpoint, flushIntervalMs })`.
- `track({ event, visitorId, properties, accountId, timestamp })` — buffered.
- `identify({ visitorId, accountId, traits })`.
- `flag(visitorId, key)` — sync, cached.
- `flags(visitorId, traits)` — async, hits `/v1/sdk/flags/evaluate`.
- `flush()` and `shutdown()` — queue lifecycle.
- Built-in PII redaction (email, phone, card, SSN) on property values.
- Native `fetch` based (Node 18+, no runtime deps).
- TypeScript types shipped in `index.d.ts`.

### Changed
- Renamed package from `@pulse/node` to `@luniq/node`.
- Repository moved to `https://github.com/BitCodeHub/luniq-sdk-node`.
