# explore: design

Date: 2026-10-15. Status: settled in a grilling round (Q1–Q10, every recommendation accepted), pending spec review. Terms as in `GLOSSARY.md`.

## Goal

A grilling session (`/grill-with-docs`, a `/wayfinder` grilling ticket) hands the owner a frontier of 7–12 questions. Most are quick, but one needs depth. The owner explores that one in the drawer: its options, their impact, cost, risk and reversibility, and a recommendation. Follow-ups are asked there too. None of it leaves the conversation or adds to it, and the conclusion is then taken back into the owner's reply.

Success: a frontier of ten questions lands, and the hint line says `10 questions · /explore to dig into one`. The owner types half their reply, runs `/explore 5`, reads the options, asks one follow-up and presses `take B`. `5: B, <option name>` appears at the cursor in their draft. They finish the reply and send it. The main conversation holds only that reply.

## Decisions

| Topic | Decision |
| --- | --- |
| Mod name, command | `explore/` in this repo, and `/explore`. The command is registered `immediate`, so it "runs at once when typed mid-turn". |
| Its own mod | Separate from artifacts. It reaches artifacts only through that mod's tool, so each works without the other. |
| The drawer | The engine's `AbovePrompt` band. It uses the room the band allows (up to half the terminal in fullscreen), and taller content scrolls. ctrl+x ctrl+a folds it. It yields while a survey holds the band (`hasSurvey`). |
| The frontier | The newest assistant message that has ❓ questions, looking back past later messages without them (`$.session.messages()`). When it isn't the last message, the drawer says "from N messages ago". |
| Reading the questions | Parsed straight from the grilling format, `❓ **Q<n>** - **<title>**: <body>`, then `➡️ <recommendation>`. A message with no ❓ but three or more lines ending in `?` falls back to one Haiku call (`$.model.complete`) that lists its questions. The result is kept per message, so reopening the drawer costs nothing. |
| Commands | `/explore`: the picker. `/explore 5`: straight to Q5 (a number the frontier lacks opens the picker with a note). `/explore <text>`: a free question. With no frontier, `/explore` opens the drawer on a field: "what do you want to explore?" |
| One exploration | One `$.model.fork({ prompt })` over the main conversation: no tools, the prefix served from the cache, nothing added. The prompt says this is a side exploration that must not carry on the main work. It names the question (number, title, body and the grill's recommendation) and asks for the answer's shape. |
| The answer's shape | Options, each headed `### A. <name>`, `### B. <name>` and so on, each covering what it means, its impact on the current work, cost and risk, and how reversible it is. Then a recommendation, and what would change it. Follow-ups are free-form. |
| Follow-ups | A field in the drawer. Each follow-up is a new fork whose prompt carries the exploration so far, then the follow-up. |
| Several explorations | Any number per session. The picker marks explored questions with `●`, and choosing one reopens its exploration. They live in the session's mod state, which survives mod reloads; save to artifacts is what keeps one past the session. |
| Take back | One button per option heading the answer parsed: `take B` inserts `5: B, <option name>` at the cursor (`$.prompt.fill`, mode `insert`) without a model call. `take summary` forks once more for one or two sentences in the owner's voice and inserts `5: <summary>`. A free question gets no number. When the fill reports `isFilled: false` (a dialog is up, or the session is headless), the text goes to the clipboard (`$.ui.copy`) and a toast says so. If no option headings parse, only `take summary` shows. |
| Save to artifacts | `$.tool.call` of `mcp__artifacts__show`: the title is the question's title, the kind is `exploration`, and the body is the whole exploration (the question with the grill's recommendation, the answer, each follow-up, and what was taken back). Saving the same exploration again passes the id that came back, which adds a version. The button shows only while `$.tool.list()` has the tool. |
| The hint line | After a turn completes whose last assistant message has three or more ❓ lines, the band shows one dim line: `N questions · /explore to dig into one`. It goes at the next prompt submit. Spotting the questions is a text check with no model call. |
| Status | While a fork runs, the drawer says `thinking…` with the spinner. After it, it shows how long the call took and its output tokens, from the result's `usage`. |

## The drawer

**Picker**:

```
explore · 10 questions · from the last message
 1  Name                                 ➡️ keep /explore
 2  Which message is the frontier        ➡️ (b)
 …
●5  What "take back" inserts             ➡️ (c)
 what do you want to explore? ▏
```

Digits 1–9 press a row once the drawer has the keyboard (ctrl+x tab, or a click). Rows 10 and up are clicked, or reached with `/explore 10`.

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
- **The Haiku listing fails**: the picker says so and opens on the free-question field.
- **`/explore 5` while a fork for Q5 is already running**: it shows that exploration and starts no second call.

## Testing

Test first with the mods test kit, with `session.messages`, `model.fork`, `model.complete`, `prompt.fill`, `ui.copy` and `tool.list`/`tool.call` answered by test hooks. The fixtures are real messages: this session's first grilling round (10 ❓ questions), a message with only `?` lines, and one with no questions.

- **Parsing**: numbers, titles, bodies and recommendations come out of the grilling round. The `?`-only message takes the Haiku path, and the plain one finds no frontier. An older frontier behind a newer plain message is found and labelled.
- **Commands**:
  - `/explore` draws the picker, `/explore 5` forks with Q5 named in the prompt, `/explore <text>` forks a free question, and an unknown number opens the picker with a note.
  - The command is registered `immediate`.
- **Answers**: option headings become take buttons. With no headings, only `take summary` shows.
- **Take back**:
  - `take B` fills `5: B, <name>` in `insert` mode.
  - `isFilled: false` copies and toasts.
  - `take summary` forks once and fills its text.
- **Save**: it calls the artifacts tool with kind `exploration`. A second save passes the returned id. The button is hidden when the tool isn't listed.
- **Hint**: it appears after a turn completes with three or more ❓ lines, and is gone after the next submit.
- **Several explorations**: Q5 and Q7 are both listed with `●`, and reopening one shows its own exploration.
- A deliberate breakage of each guard, to prove a test fails without it.

Then a live check in a herdr test session: a real `/grill-with-docs` round, `/explore` on one question while a reply is half typed, a follow-up, take back, and save to artifacts with that mod loaded.

## Out of scope (v1)

- **Tools in an exploration:** `model.fork` is tool-less, so an exploration reasons over the conversation and reads no files.
- Explorations kept past the session other than through save to artifacts.
- Questions asked in an `AskUserQuestion` dialog: the grills used here write theirs as text.
- Exploring a frontier older than the newest one.
