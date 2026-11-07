# Inbox Triage Desk

A single-page tool that turns a work email CSV export into:

- an **action summary**: actions you can tick off, set to To do / In progress / Waiting / Done, and add timestamped updates to
- a time-blocked plan for the working day
- reply drafts for emails that need a response (with tone and your own steer)
- candid coaching points drawn from the inbox itself
- an **Asana export**:
  - *New actions* CSV: only actions not exported before, so re-importing doesn't duplicate tasks
  - *Updates since last time*: text to paste into an Asana status update or task comment
    (Asana's CSV import creates tasks; it cannot update existing ones)
  - *Full snapshot* CSV: every action, with status as Section/Column, priority as a tag, update history in the description

## CSV import

Drop or choose a `.csv` file. Subject, From, Date and Body columns are auto-detected
(Outlook's `From: (Name)` / `From: (Address)` split is handled) and can be remapped.
Bodies are trimmed to 2,500 characters each, and about 170k characters in total are sent per run.

## Runtime

It runs as a claude.ai Artifact using the `sample` (Claude), `downloads`, `db` and `user` capabilities.
Action state syncs to the viewer's private `data/users/<id>/desk` document, with a localStorage cache.
Opened outside claude.ai, the page renders the built-in example, but triage, drafting and downloads are disabled.
