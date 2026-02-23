# Stoat AI Interface Bring-Up Roadmap

Goal: get `stoat-ai-interface` reliably working in an OpenClaw environment with repeatable checks.

## Input Handoff (Prior Bot Config Only)

- [x] Import prior Stoat instance details (token/base URL/ws/server/channel/bot IDs) into local `.env`
- [x] Record handoff context in `INSTANCE_HANDOFF.md`
- [x] Preserve constraint: do not copy implementation code from prior bot

## Phase 1 — Baseline Verification

- [x] Install dependencies and confirm clean install
- [x] Run typecheck and resolve any compile/type issues
- [x] Add and run baseline unit tests (`npm test`)
- [x] Document local run/verification workflow in README

## Phase 2 — Runtime Compatibility (OpenClaw)

- [x] Verify plugin manifest and entrypoints are compatible with current OpenClaw loading expectations
- [x] Validate channel config shape and required env/config fields
- [x] Add a minimal dry-run/smoke path for plugin init (without external network dependency)
- [x] Document known compatibility assumptions and version constraints

## Phase 3 — End-to-End Validation

- [x] Test connection against a real Stoat instance with bot token
- [x] Verify inbound message routing behavior (mention-gating + DM)
- [x] Verify outbound send/reply behavior
- [x] Verify reactions/typing behavior
- [x] Capture setup/troubleshooting notes from real run

## Validation Evidence Snapshot

- Real-instance live check script: `scripts/e2e-live-check.mjs`
- Inbound routing guard tests (mention-gating + DM): `test/monitor-routing.test.mjs`
- Manifest/entry compatibility tests: `test/manifest-compat.test.mjs`

## Quality Gates (Every Iteration)

1. Keep each change small and focused.
2. Run `npm test` and `npm run typecheck` when code changes.
3. If behavior logic changes, add or update unit tests in the same pass.
4. Update `ROADMAP.md` + README status notes as work advances.
5. Commit with a clear, single-purpose message.
