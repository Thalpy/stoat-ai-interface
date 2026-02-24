# Stoat Bring-Up: Start From Scratch

Assumptions:
- Existing unit tests/typecheck are considered baseline-good.
- Goal is operational live replies in Stoat channel(s), not re-proving old tests.

## Known Runtime Inputs (preloaded)
- Bot token: present in local `.env` (`STOAT_BOT_TOKEN`)
- API URL: `https://bamalam.xyz/api`
- WS URL: `wss://bamalam.xyz/ws`
- Bot ID: `01KJ4MGXP1PXVT5SR3FZDB9H9S`
- Prior known working server: `01KJ4MG98HCXT8TVH51WGA880S`
- Prior known working channel: `01KJ4MG98H44YMMSJ0BSSJZG1X`
- Reported failing channel: `01KJ6BZHYC2BBHMR8QQS278KR2`

## Execution Policy
1. Start from live connectivity and routing checks first.
2. Assume tests are okay unless a concrete runtime symptom points to code regression.
3. Prefer environment/config alignment and membership/permission checks before code changes.
4. If blocked, output exactly what is missing from operator side.

## Missing-Input Contract
If live reply path still fails, report only actionable missing inputs in this format:
- `NEED: <item>`
- `WHY: <reason>`
- `HOW_TO_PROVIDE: <exact step>`
