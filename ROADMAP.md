# Stoat AI Interface Bring-Up Roadmap

Goal: get `stoat-ai-interface` reliably working in an OpenClaw environment with repeatable checks.

## Phase 1 — Baseline Verification

- [ ] Install dependencies and confirm clean install
- [x] Run typecheck and resolve any compile/type issues
- [x] Add and run baseline unit tests (`npm test`)
- [x] Document local run/verification workflow in README

## Phase 2 — Runtime Compatibility (OpenClaw)

- [ ] Verify plugin manifest and entrypoints are compatible with current OpenClaw loading expectations
- [x] Validate channel config shape and required env/config fields
- [ ] Add a minimal dry-run/smoke path for plugin init (without external network dependency)
- [ ] Document known compatibility assumptions and version constraints

## Phase 3 — End-to-End Validation

- [ ] Test connection against a real Stoat instance with bot token
- [ ] Verify inbound message routing behavior (mention-gating + DM)
- [ ] Verify outbound send/reply behavior
- [ ] Verify reactions/typing behavior
- [ ] Capture setup/troubleshooting notes from real run

## Quality Gates (Every Iteration)

1. Keep each change small and focused.
2. Run `npm test` and `npm run typecheck` when code changes.
3. If behavior logic changes, add or update unit tests in the same pass.
4. Update `ROADMAP.md` + README status notes as work advances.
5. Commit with a clear, single-purpose message.
