# explore

A drawer above the prompt for one question of a grilling round. A grill (`/grill-with-docs`, a `/wayfinder` grilling ticket) asks seven to twelve questions at once. Most take a word, and one needs thought. Press the hint above the prompt, pick that one, and the drawer lays out its options, what each costs and risks, how reversible it is, and a recommendation. Ask follow-ups there, press `take B`, and `5: B, <option>` lands at the cursor in your reply. None of it enters the conversation.

Requires Claude Code 2.1.318 or later.

```
e: 10 questions · explore

explore · 10 questions · from the last message                close
   1  Name                                      ➡️ Keep /explore
   2  Which message is the frontier             ➡️ (b)
●  5  Several explorations per session          ➡️ (b)

← questions  Q4 · What "take back" inserts                      close
### A. One button per option
…
answered in 14s · 1.2k tokens
follow-up ask about this
take A  take B  take C  take summary  save to artifacts
```

- **The hint**: after a turn whose answer asks three or more ❓ questions, a dim button above the prompt says `e: 10 questions · explore`. Press it with a click, or with `e` once the band has the keyboard (ctrl+x tab). It opens the picker without touching your half-written reply, and it goes when you send.
- **Opening**: `/explore` and `/explore 5` do the same from an empty prompt box: `/explore` opens the picker, `/explore 5` goes straight to Q5. The picker lists the questions of the newest message that has them, even if Claude has said something since ("from 2 messages ago"). The command runs at once, even mid-turn. Opening the drawer moves the keyboard into it: onto the first question, or onto an exploration's follow-up field once it has an answer (`← questions` until then).
- **Picking**: click a question, or, with the band holding the keyboard, tab to it and press Enter. Digits don't pick: a digit typed into an empty prompt box would press a numbered button, and a reply starting `1 ok` would open Q1.
- **A new round**: when the next round of questions lands, the drawer closes and the new round's hint shows. If an exploration is still thinking, the drawer stays open until you close it. `← questions` always lists the newest round. Your explorations stay for the session.
- **No questions**: with none anywhere, the drawer says `no questions to explore · /btw for a side question`. For a question of your own, use `/btw`.
- **Reading the questions**: the grilling format (`❓ **Q5** - **title**: body`, then `➡️ recommendation`) is read straight from the text. A message with no ❓ but three or more lines ending in `?` is listed once by Haiku; if that listing fails, the drawer says why and stops there.
- **An exploration**: one fork of the conversation. It calls no tools, reuses the transcript's cached prefix, and adds nothing to the conversation. A follow-up forks again, carrying the exploration so far. Explore as many questions as you like: the list marks explored ones with `●`, and picking one reopens it.
- **Take back**: `take B` puts `5: B, <option>` at the cursor with no model call. `take summary` forks once more, at low effort, for a sentence or two in your voice. After a take, the keyboard is back in the prompt box, at the end of the inserted text, so you can keep typing your reply. Under a dialog the text goes to the clipboard instead, and a toast says so.
- **Save to artifacts**: with the [artifacts](../artifacts/) mod loaded, this saves the whole exploration as an artifact of kind `exploration`: the question, the grill's recommendation, the answer, each follow-up and what you took back. Saving again adds a version. A failed save shows on the status line.
- **The drawer**: it is the band above the prompt. ctrl+x ctrl+a folds it, and ctrl+x tab or a click gives it the keyboard. It steps aside while a survey uses the band.
- **Errors**: a failed fork shows on the status line, with retry where retrying can help.

Install it as in [Installing a mod](../README.md#installing-a-mod), with the folder `explore`.
