# DAX Doctor

Paste a Power BI DAX measure or calculated column, and DAX Doctor:

1. **Checks it instantly** (free and offline) for syntax errors and common slow or risky patterns: `/` instead of `DIVIDE`, `IFERROR`, `FILTER` over whole tables, `SUMX(FILTER(...))`, `EARLIER`, deeply nested `IF`, `SUMMARIZE` with added columns, forcing zeros with `+ 0` or `COALESCE(..., 0)`, repeated expressions that belong in a `VAR`, and more.
2. **Formats it** in the same style as SQLBI's DAX Formatter.
3. **Asks Claude for a better version** (optional). Claude explains what is wrong and returns a rewritten measure you can copy back into Power BI.

It runs on **Windows and Mac** in any modern browser (Edge, Chrome, Safari, Firefox). There is nothing to install.

## How to run it

1. Download this `dax-doctor` folder. On GitHub, use **Code → Download ZIP**, then unzip it.
2. Double-click `index.html`. It opens in your browser.
3. Paste your DAX and press **Check**.

Keep `engine.js` and the `vendor` folder next to `index.html`.

## Using the Claude review

The instant checks need nothing. The **Improve with Claude** button needs an Anthropic API key:

1. Create a key at <https://console.anthropic.com> and add a few dollars of credit. API usage is billed separately from a Claude.ai subscription.
2. In DAX Doctor, open **API key settings** and paste the key. Tick **Remember** to keep it on this computer.

Your key and code are sent only to `api.anthropic.com`. If you tick **Remember**, the key is saved in your browser's local storage, so anyone with access to your computer account could read it. Leave it unticked on shared machines.

## What it can't do

Most slow Power BI reports are slow because of the **data model**, not the DAX syntax. Typical causes are high-cardinality columns, bi-directional relationships, large calculated columns and too many visuals on one page. DAX Doctor only sees the code you paste. To measure the model itself, use [Bravo](https://bravo.bi) or DAX Studio (VertiPaq Analyzer) on Windows, plus the Performance Analyzer pane in Power BI Desktop.

The instant checks are pattern-based. They can flag code that is fine in your situation. Treat them as prompts to think, not as rules.

## Development

- `engine.js`: tokenizer, checks and formatter. It has no dependencies.
- `index.html`: the page.
- `vendor/anthropic-sdk-1.1.0.min.js`: the official Anthropic TypeScript SDK (`@anthropic-ai/sdk@1.1.0`) bundled for the browser with esbuild. Licenses are in `vendor/`.
- Run the tests with `node dax-doctor/test/engine.test.js`.

To add a check, add a block in `check()` in `engine.js` that pushes `{ id, severity, line, title, detail, fix? }`, then add a test.
