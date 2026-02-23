# Instance Handoff (from prior bot)

This file carries runtime connection details from the previous Stoat bridge setup for bring-up/testing only.

## Source
- Prior project: `/Users/admin/.openclaw/workspace/projects/stoat-pepper-bridge/.env`

## Imported values
- `STOAT_BASE_URL=https://bamalam.xyz/api`
- `STOAT_WS_URL=wss://bamalam.xyz/ws`
- `STOAT_SERVER_ID=01KJ4MG98HCXT8TVH51WGA880S`
- `STOAT_CHANNEL_ID=01KJ4MG98H44YMMSJ0BSSJZG1X`
- `STOAT_BOT_ID=01KJ4MGXP1PXVT5SR3FZDB9H9S`
- `MENTION_ONLY=true`
- `COMMAND_PREFIX=!pepper`
- Bot token imported into local `.env` (kept out of git)

## Constraint
- Do **not** copy implementation code from the prior bot.
- Use this as config/input only while building fresh implementation in this repo.
