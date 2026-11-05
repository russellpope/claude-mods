# explore: design

Date: 2026-10-15. Status: settled in a grilling round (Q1–Q10, every recommendation accepted). Amended 2026-11-04 by a second grilling round (Q1–Q10 again, every recommendation accepted) for what changed since: see [Amendments, 2026-11-04](#amendments-2026-11-04), which win over anything below. Terms as in `GLOSSARY.md`.

## Goal

A grilling session (`/grill-with-docs`, a `/wayfinder` grilling ticket) hands the owner a frontier of 7–12 questions. Most are quick, but one needs depth. The owner explores that one in the drawer: its options, their impact, cost, risk and reversibility, and a recommendation. Follow-ups are asked there too. None of it leaves the conversation or adds to it, and the conclusion is then taken back into the owner's reply.

Success: a frontier of ten questions lands, and the hint line says `10 questions · explore`. The owner types half their reply, presses the hint (a click, or ctrl+x tab then `e`), picks 5, reads the options, asks one follow-up and presses `take B`. `5: B, <option name>` appears at the cursor in their draft. They finish the reply and send it. The main conversation holds only that reply.

## Decisions

| Topic | Decision |
| --- | --- |
| Mod name, command | `explore/` in this repo, and `/explore`. The command is registered `immediate`, so it "runs at once when typed mid-turn". |
| Its own mod | Separate from artifacts. It reaches artifacts only through that mod's tool, so each works without the other. |
| The drawer | The engine's `AbovePrompt` band. It uses the room the band allows (up to half the terminal in fullscreen), and taller content scrolls. ctrl+x ctrl+a folds it. It yields while a survey holds the band (`hasSurvey`). |
| The frontier | The newest assistant message that has ❓ questions, looking back past later messages without them (`$.session.messages()`). When it isn't the last message, the drawer says "from N messages ago". |
| Reading the questions | Parsed straight from the grilling format, `❓ **Q<n>** - **<title>**: <body>`, then `➡️ <recommendation>`. A message with no ❓ but three or more lines ending in `?` falls back to one Haiku call (`$.model.complete`) that lists its questions. The result is kept per message, so reopening the drawer costs nothing. |
| Commands | `/explore`: the picker. `/explore 5`: straight to Q5 (a number the frontier lacks opens the picker with a note). With no frontier, the drawer says `no questions to explore · /btw for a side question`. The hint button opens the picker too (amendment 7). |
| One exploration | One `$.model.fork({ prompt })` over the main conversation: no tools, the prefix served from the cache, nothing added. The prompt says this is a side exploration that must not carry on the main work. It names the question (number, title, body and the grill's recommendation) and asks for the answer's shape. |
| The answer's shape | Options, each headed `### A. <name>`, `### B. <name>` and so on, each covering what it means, its impact on the current work, cost and risk, and how reversible it is. Then a recommendation, and what would change it. Follow-ups are free-form. |
| Follow-ups | A field in the drawer. Each follow-up is a new fork whose prompt carries the exploration so far, then the follow-up. |
| Several explorations | Any number per session. The picker marks explored questions with `●`, and choosing one reopens its exploration. They live in the session's mod state, which survives mod reloads; save to artifacts is what keeps one past the session. |
| Take back | One button per option heading the answer parsed: `take B` inserts `5: B, <option name>` at the cursor (`$.prompt.fill`, mode `insert`) without a model call. `take summary` forks once more for one or two sentences in the owner's voice and inserts `5: <summary>`. When the fill reports `isFilled: false` (a dialog is up, or the session is headless), the text goes to the clipboard (`$.ui.copy`) and a toast says so. If no option headings parse, only `take summary` shows. |
| Save to artifacts | `$.tool.call` of `mcp__artifacts__show`: the title is the question's title, the kind is `exploration`, and the body is the whole exploration (the question with the grill's recommendation, the answer, each follow-up, and what was taken back). Saving the same exploration again passes the id that came back, which adds a version. The button shows only while `$.tool.list()` has the tool. |
| The hint button | After a turn completes whose last assistant message has three or more parsed questions, the band shows one button: `N questions · explore`, where N counts the parsed questions. Pressing it (a click, or `e` with the band focused) opens the picker. It goes at the next prompt submit. Spotting the questions is a text check with no model call. |
| Status | While a fork runs, the drawer says `thinking…` with the spinner. After it, it shows how long the call took and its output tokens, from the result's `usage`. |

## The drawer

**Picker**:

```
explore · 10 questions · from the last message
 1  Name                                 ➡️ keep /explore
 2  Which message is the frontier        ➡️ (b)
 …
●5  What "take back" inserts             ➡️ (c)
```

A row is picked by a click, or by Enter once the drawer has the keyboard (tab moves between rows). Rows have no digit keys: a digit typed into an empty prompt box would press one (amendment 12). `/explore N` reaches any row from an empty box.

**An exploration**:

```
← questions   Q5 · What "take back" inserts
### A. One button per option
…
### B. A summary in your voice
…
Recommendation: …
answered in 14s · 1.2k tokens
follow-up ▏
 take A  take B  take summary │ save to artifacts │ close
```

## Errors

Every failure shows on the drawer's status line in place of the answer, with a `retry` button where retrying can help.

- `nothing-to-fork` (no reply yet, or just after `/clear`): "nothing to explore yet".
- `api-error`: its status and kind, and `retry`.
- `empty-reply`: "no answer", and `retry`.
- `aborted`: "cancelled", and `retry`.
- **The Haiku listing fails**: the drawer says so and stops there.
- **`/explore 5` while a fork for Q5 is already running**: it shows that exploration and starts no second call.

## Testing

Test first with the mods test kit, with `session.messages`, `model.fork`, `model.complete`, `prompt.fill`, `ui.copy` and `tool.list`/`tool.call` answered by test hooks. The fixtures are real messages: this session's first grilling round (10 ❓ questions), a message with only `?` lines, and one with no questions.

- **Parsing**: numbers, titles, bodies and recommendations come out of the grilling round. The `?`-only message takes the Haiku path, and the plain one finds no frontier. An older frontier behind a newer plain message is found and labelled.
- **Commands**:
  - `/explore` draws the picker, `/explore 5` forks with Q5 named in the prompt, and an unknown number opens the picker with a note.
  - The command is registered `immediate`.
- **Answers**: option headings become take buttons. With no headings, only `take summary` shows.
- **Take back**:
  - `take B` fills `5: B, <name>` in `insert` mode.
  - `isFilled: false` copies and toasts.
  - `take summary` forks once and fills its text.
- **Save**: it calls the artifacts tool with kind `exploration`. A second save passes the returned id. The button is hidden when the tool isn't listed.
- **Hint**: it appears after a turn completes with three or more parsed questions, and is gone after the next submit.
- **Several explorations**: Q5 and Q7 are both listed with `●`, and reopening one shows its own exploration.
- A deliberate breakage of each guard, to prove a test fails without it.

Then a live check in a Rex test session: a real `/grill-with-docs` round, the hint button on one question while a reply is half typed, a follow-up, take back, and save to artifacts with that mod loaded.

## Out of scope (v1)

- **Tools in an exploration:** `model.fork` is tool-less, so an exploration reasons over the conversation and reads no files.
- Explorations kept past the session other than through save to artifacts.
- Questions asked in an `AskUserQuestion` dialog: the grills used here write theirs as text.
- Exploring a frontier older than the newest one.
- **Free questions** (from 2026-11-04): Claude Code's built-in `/btw` answers a free side question.

## Amendments, 2026-11-04

A second grilling round, after Claude Code moved from 2.1.300 to 2.1.318, the owner moved from herdr to Rex, and the artifacts mod merged. Every recommendation was accepted. These win over the sections above.

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Scope | v1 as specified, less free questions (6). |
| 6 | Free questions | Dropped: the built-in `/btw` ("Ask a quick side question without interrupting the main conversation") covers them. `/explore <text>` and the free-question field go. With no frontier, `/explore` and the drawer say `no questions to explore · /btw for a side question`. When the Haiku listing fails, the drawer says so and stops there. Follow-ups keep their field. |
| 7 | Opening over a draft | A slash command is typed at the start of the prompt box, which holds the half-written reply, so the hint line becomes a button: `10 questions · explore`, pressed by a click or, with the band focused, `e`. It opens the picker without touching the draft. `/explore` and `/explore N` stay, for an empty box; the command's hint is `[n]`. |
| 8 | Keyboard | When explore opens the drawer (from the hint or the command) it moves the keyboard there with `$.ui.focus`, using the `requestId` its `AbovePrompt` render hook receives. Where the keyboard lands after a take back is recorded in the live check. |
| 9 | Effort | Explorations and follow-ups fork at the session's own effort (no `effort` passed). Take summary forks with `effort: 'low'`. |
| 10 | Minimum version | The README says it requires Claude Code 2.1.318 or later. A minimum, never a pin; no runtime check. |
| 3 | Live check | In Rex, driven with the team helper (`skills/lib/rex-team.sh` in deepthought): `spawn`, `prompt`, `keys`, `read`, and `rex capture`. Where the helper can't reach the band's keys, the owner presses them while the check watches. |

To check in the live run: the engine says a bare digit typed into an empty prompt box answers a band button (for surveys). If it also presses the picker's numbered rows, the rows move to letters or clicks. (It did: see 12.)

Settled during the build and the live check (2026-11-05):

| # | Topic | Decision |
| --- | --- | --- |
| 11 | Hint count | The hint counts parsed questions, not lines that hold ❓. |
| 12 | Picker rows | A digit typed into an empty prompt box pressed a picker row in the live check. Rows have no hotkey: click, or tab and Enter. |
| 13 | Format drift | A title with its colon missing or inside the bold (`**T**` or `**T:**`) still starts a question, and a `?` line that ends in bold or italic marks still counts. A small model wrote the first shape in the live check, and no hint showed. |
