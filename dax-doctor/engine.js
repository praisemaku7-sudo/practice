/*
 * DAX Doctor engine: tokenizer, rule checks and formatter for DAX.
 * Runs entirely offline. Works in the browser (window.DaxDoctor) and in Node (module.exports).
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- tokenizer

  // Token types: ws, nl, comment, string, table, column, number, ident, op, lparen, rparen, comma, unknown
  function tokenize(src) {
    const tokens = [];
    const errors = [];
    let i = 0;
    let line = 1;
    const n = src.length;
    const push = (type, text, startLine) => tokens.push({ type, text, line: startLine });

    while (i < n) {
      const c = src[i];
      const startLine = line;

      if (c === "\n") { push("nl", c, startLine); line++; i++; continue; }
      if (c === " " || c === "\t" || c === "\r" || c === " ") {
        let j = i;
        while (j < n && /[ \t\r ]/.test(src[j])) j++;
        push("ws", src.slice(i, j), startLine); i = j; continue;
      }
      // line comments: // or --
      if ((c === "/" && src[i + 1] === "/") || (c === "-" && src[i + 1] === "-")) {
        let j = i;
        while (j < n && src[j] !== "\n") j++;
        push("comment", src.slice(i, j), startLine); i = j; continue;
      }
      // block comment
      if (c === "/" && src[i + 1] === "*") {
        let j = src.indexOf("*/", i + 2);
        if (j === -1) { errors.push({ line: startLine, msg: "Block comment /* is never closed with */" }); j = n; } else j += 2;
        const text = src.slice(i, j);
        line += (text.match(/\n/g) || []).length;
        push("comment", text, startLine); i = j; continue;
      }
      // "string" with "" escape, 'table' with '' escape, [column] with ]] escape
      if (c === '"' || c === "'" || c === "[") {
        const close = c === "[" ? "]" : c;
        const type = c === '"' ? "string" : c === "'" ? "table" : "column";
        let j = i + 1;
        let closed = false;
        while (j < n) {
          if (src[j] === close) {
            if (src[j + 1] === close) { j += 2; continue; }
            closed = true; j++; break;
          }
          if (src[j] === "\n") line++;
          j++;
        }
        if (!closed) {
          const what = type === "string" ? 'Text in double quotes "' : type === "table" ? "Table name in single quotes '" : "Column/measure name in square brackets [";
          errors.push({ line: startLine, msg: what + " is never closed" });
        }
        push(type, src.slice(i, j), startLine); i = j; continue;
      }
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
        let j = i;
        while (j < n && /[0-9.]/.test(src[j])) j++;
        if (/[eE]/.test(src[j] || "") && /[-+0-9]/.test(src[j + 1] || "")) {
          j += 2;
          while (j < n && /[0-9]/.test(src[j])) j++;
        }
        push("number", src.slice(i, j), startLine); i = j; continue;
      }
      if (/[A-Za-z_À-￿]/.test(c)) {
        let j = i;
        while (j < n && /[A-Za-z0-9_.À-￿]/.test(src[j])) j++;
        push("ident", src.slice(i, j), startLine); i = j; continue;
      }
      if (c === "(") { push("lparen", c, startLine); i++; continue; }
      if (c === ")") { push("rparen", c, startLine); i++; continue; }
      if (c === "," || c === ";") { push("comma", c, startLine); i++; continue; }
      const two = src.slice(i, i + 2);
      if (["&&", "||", "<=", ">=", "<>", "==", ":="].includes(two)) { push("op", two, startLine); i += 2; continue; }
      if ("+-*/^&=<>{}".includes(c)) { push("op", c, startLine); i++; continue; }
      push("unknown", c, startLine); i++;
    }
    return { tokens, errors };
  }

  const isTrivia = (t) => t.type === "ws" || t.type === "nl" || t.type === "comment";

  // Significant tokens with a matching-paren index and the name of the function that owns each paren.
  function analyze(src) {
    const { tokens, errors } = tokenize(src);
    const sig = tokens.filter((t) => !isTrivia(t));
    const stack = [];
    for (let k = 0; k < sig.length; k++) {
      const t = sig[k];
      if (t.type === "lparen") {
        const prev = sig[k - 1];
        t.fn = prev && prev.type === "ident" ? prev.text.toUpperCase() : null;
        t.fnIndex = t.fn ? k - 1 : -1;
        stack.push(k);
      } else if (t.type === "rparen") {
        if (!stack.length) {
          errors.push({ line: t.line, msg: "There is a ) with no matching (" });
        } else {
          const open = stack.pop();
          sig[open].match = k;
          t.match = open;
        }
      }
    }
    for (const k of stack) errors.push({ line: sig[k].line, msg: "There is a ( that is never closed" + (sig[k].fn ? " (after " + sig[k].fn + ")" : "") });
    // Parent function for every token
    const parents = [];
    for (let k = 0; k < sig.length; k++) {
      const t = sig[k];
      t.parents = parents.slice();
      if (t.type === "lparen") parents.push(t.fn || "(");
      else if (t.type === "rparen") parents.pop();
    }
    return { tokens, sig, errors };
  }

  // Split arguments of the call whose "(" is at index open in sig. Returns arrays of [start, end) indexes.
  function callArgs(sig, open) {
    const close = sig[open].match;
    if (close === undefined) return [];
    const args = [];
    let depth = 0;
    let start = open + 1;
    for (let k = open + 1; k < close; k++) {
      const t = sig[k];
      if (t.type === "lparen") depth++;
      else if (t.type === "rparen") depth--;
      else if (t.type === "comma" && depth === 0) { args.push([start, k]); start = k + 1; }
    }
    if (close > start || args.length) args.push([start, close]);
    return args;
  }

  const textOf = (sig, a, b) => sig.slice(a, b).map((t) => t.text).join(" ");

  // ---------------------------------------------------------------- rules

  // Functions that do not change the filter context of their arguments
  const SCALAR_SAFE = ["(", "IF", "IF.EAGER", "SWITCH", "DIVIDE", "AND", "OR", "NOT", "ROUND", "ROUNDUP", "ROUNDDOWN", "ABS", "COALESCE", "ISBLANK", "INT", "MAX", "MIN", "FORMAT", "CONCATENATE", "BLANK", "VALUE", "INT", "TRUNC", "MROUND", "SQRT", "POWER", "EXP", "LN", "LOG", "SIGN"];

  const ITERATORS = ["SUMX", "AVERAGEX", "COUNTX", "COUNTAX", "MINX", "MAXX", "PRODUCTX", "CONCATENATEX", "RANKX"];

  function check(src) {
    const { sig, errors } = analyze(src);
    const findings = [];
    const add = (f) => findings.push(f);

    for (const e of errors) {
      add({ id: "syntax", severity: "error", line: e.line, title: "Syntax problem", detail: e.msg + ". Power BI will reject this until it is fixed." });
    }
    if (!sig.length) return findings;

    const upper = (t) => (t && t.type === "ident" ? t.text.toUpperCase() : null);
    const seen = new Set();
    const once = (id, f) => { if (!seen.has(id)) { seen.add(id); add(f); } };

    // nested IF depth
    let maxIfDepth = 0;
    let ifLine = 0;

    for (let k = 0; k < sig.length; k++) {
      const t = sig[k];
      const u = upper(t);
      const next = sig[k + 1];
      const isCall = u && next && next.type === "lparen";

      if (t.type === "op" && t.text === "/") {
        const d = sig[k + 1];
        const constantDenominator = d && d.type === "number" && Number(d.text) !== 0;
        if (!constantDenominator) {
          add({ id: "divide", severity: "warning", line: t.line, title: "Division with / can fail on zero or blank",
            detail: "If the bottom number can be 0 or blank, / returns an error or infinity. DIVIDE ( top, bottom ) returns BLANK instead, which visuals hide, and is optimized by the engine.",
            fix: "DIVIDE ( numerator, denominator )" });
        }
      }

      if (!isCall) continue;

      if (u === "IFERROR" || u === "ISERROR") {
        add({ id: "iferror", severity: "warning", line: t.line, title: u + " is slow",
          detail: u + " forces Power BI to evaluate the expression cell by cell and catch errors, which blocks the fast storage engine. Prevent the error instead (for example DIVIDE for division, or check the value with IF before using it)." });
      }

      if (u === "EARLIER" || u === "EARLIEST") {
        add({ id: "earlier", severity: "warning", line: t.line, title: u + " is hard to read and easy to get wrong",
          detail: "Store the outer value in a variable instead: VAR CurrentValue = Table[Column] then use CurrentValue inside the FILTER.",
          fix: "VAR CurrentValue = Table[Column]\nRETURN\n    COUNTROWS ( FILTER ( Table, Table[Column] > CurrentValue ) )" });
      }

      if (u === "FILTER") {
        const args = callArgs(sig, k + 1);
        if (args.length >= 1) {
          const [a, b] = args[0];
          const first = sig[a];
          const bareTable = b - a === 1 && (first.type === "table" || first.type === "ident");
          if (bareTable) {
            const inCalc = t.parents.some((p) => p === "CALCULATE" || p === "CALCULATETABLE");
            add({ id: "filter-table", severity: inCalc ? "warning" : "info", line: t.line,
              title: "FILTER over a whole table" + (inCalc ? " inside CALCULATE" : ""),
              detail: inCalc
                ? "FILTER ( " + first.text + ", ... ) scans every row and every column of the table, and can keep unwanted filters. Filter only the column you need. Simple conditions can go straight into CALCULATE: CALCULATE ( [Measure], " + (first.text) + "[Column] = \"Value\" ). For conditions on one column use FILTER ( ALL ( Table[Column] ), ... ) or KEEPFILTERS."
                : "Iterating a whole table is fine for small tables, but on a large fact table it is slow. If you only need some columns, filter those columns (for example FILTER ( ALL ( Table[Column] ), ... ) or VALUES ( Table[Column] ))." ,
              fix: "CALCULATE ( [Measure], KEEPFILTERS ( Table[Column] = \"Value\" ) )" });
          }
        }
      }

      if (ITERATORS.includes(u)) {
        const args = callArgs(sig, k + 1);
        if (args.length && upper(sig[args[0][0]]) === "FILTER") {
          const agg = u.replace(/X$/, "");
          add({ id: "iterator-filter", severity: "info", line: t.line, title: u + " ( FILTER ( ... ) ) can often be a CALCULATE",
            detail: "A simple sum over filtered rows is usually faster as CALCULATE ( " + agg + " ( Table[Column] ), <conditions> ), because the condition is pushed to the storage engine instead of being evaluated row by row. Only keep the iterator if you need a calculation per row (like Price * Quantity).",
            fix: "CALCULATE ( " + agg + " ( Table[Column] ), Table[OtherColumn] = \"Value\" )" });
        }
        if (t.parents.some((p) => ITERATORS.includes(p))) {
          add({ id: "nested-iterator", severity: "info", line: t.line, title: "Iterator inside another iterator",
            detail: "Nested iterators (" + u + " inside " + t.parents.filter((p) => ITERATORS.includes(p)).join(", ") + ") multiply the work: the inner one runs once per row of the outer one. That is fine on small tables but can be very slow on big ones. Check whether the inner part can be precomputed in a variable or a summarized table." });
        }
      }

      if (u === "IF") {
        const depth = t.parents.filter((p) => p === "IF").length + 1;
        if (depth > maxIfDepth) { maxIfDepth = depth; ifLine = t.line; }
      }

      if (u === "HASONEVALUE") {
        const ifParent = t.parents.includes("IF");
        const hasValues = sig.some((s) => upper(s) === "VALUES");
        if (ifParent && hasValues) {
          once("selectedvalue", { id: "selectedvalue", severity: "info", line: t.line, title: "Use SELECTEDVALUE",
            detail: "IF ( HASONEVALUE ( x ), VALUES ( x ) ) is exactly what SELECTEDVALUE does, in one call.",
            fix: "SELECTEDVALUE ( Table[Column], \"default if several\" )" });
        }
      }

      if (u === "LOOKUPVALUE") {
        add({ id: "lookupvalue", severity: "info", line: t.line, title: "LOOKUPVALUE is slower than RELATED",
          detail: "If there is a relationship between the two tables, RELATED ( OtherTable[Column] ) is faster and simpler. LOOKUPVALUE is only needed when there is no relationship." });
      }

      if (u === "SUMMARIZE") {
        const args = callArgs(sig, k + 1);
        const addsColumns = args.slice(1).some(([a]) => sig[a] && sig[a].type === "string");
        if (addsColumns) {
          add({ id: "summarize-columns", severity: "warning", line: t.line, title: "SUMMARIZE adding calculated columns",
            detail: "Adding calculated columns inside SUMMARIZE (\"Name\", expression) can return wrong numbers and is slow. Group with SUMMARIZE, then add columns with ADDCOLUMNS, or use SUMMARIZECOLUMNS.",
            fix: "ADDCOLUMNS (\n    SUMMARIZE ( Sales, Product[Category] ),\n    \"Total\", [Total Sales]\n)" });
        }
      }

      if (u === "COALESCE") {
        const args = callArgs(sig, k + 1);
        const last = args[args.length - 1];
        if (last && last[1] - last[0] === 1 && sig[last[0]].type === "number") {
          add({ id: "force-zero", severity: "warning", line: t.line, title: "Replacing blanks with a number",
            detail: "A measure that never returns BLANK makes table and matrix visuals show (and compute) every possible row combination, even ones with no data. This is one of the most common reasons a report gets slow. Only do this if you really need to show 0, and preferably in a card, not a big table." });
        }
      }

      if (u === "FORMAT") {
        once("format", { id: "format", severity: "info", line: t.line, title: "FORMAT turns numbers into text",
          detail: "FORMAT returns text, so the result sorts alphabetically, cannot be summed, and is never blank (which can make visuals compute every row). Prefer setting the format string in the measure's Format options, or use dynamic format strings." });
      }

      if (u === "COUNT" || u === "COUNTA") {
        once("count", { id: "count", severity: "info", line: t.line, title: u + " ( column ) vs COUNTROWS",
          detail: "If you want the number of rows, COUNTROWS ( Table ) is clearer and does not skip rows where the column is blank. Keep " + u + " only if skipping blanks is intended." });
      }
    }

    if (maxIfDepth >= 3) {
      add({ id: "nested-if", severity: "info", line: ifLine, title: maxIfDepth + " IFs nested inside each other",
        detail: "Deeply nested IFs are hard to read and maintain. SWITCH ( TRUE (), condition1, result1, condition2, result2, else ) does the same thing in a flat list.",
        fix: "SWITCH (\n    TRUE (),\n    [Sales] > 1000, \"High\",\n    [Sales] > 100, \"Medium\",\n    \"Low\"\n)" });
    }

    // = BLANK() comparisons
    for (let k = 0; k + 3 < sig.length; k++) {
      const t = sig[k];
      if (t.type === "op" && (t.text === "=" || t.text === "<>") && upper(sig[k + 1]) === "BLANK" && sig[k + 2].type === "lparen") {
        const prevIsHeader = k > 0 && sig.slice(0, k).every((s) => s.type !== "lparen") && k === headerEquals(sig);
        if (prevIsHeader) continue;
        add({ id: "blank-compare", severity: "info", line: t.line, title: t.text + " BLANK () also matches 0 and empty text",
          detail: "In DAX, 0 = BLANK () and \"\" = BLANK () are both TRUE. If you mean \"really blank\", use ISBLANK ( x ) or the strict operator ==." });
      }
    }

    // "+ 0" at the end of a measure forces zeros
    const tail = sig.slice(-2);
    if (tail.length === 2 && tail[0].type === "op" && tail[0].text === "+" && tail[1].type === "number" && Number(tail[1].text) === 0) {
      add({ id: "force-zero", severity: "warning", line: tail[0].line, title: "+ 0 at the end forces zeros",
        detail: "Adding 0 so the measure never returns BLANK makes table and matrix visuals show (and compute) every possible row combination. That is a common cause of slow visuals. Remove + 0 unless you really need zeros shown." });
    }

    // Repeated expressions -> VAR
    const counts = new Map();
    for (let k = 0; k < sig.length; k++) {
      const t = sig[k];
      if (t.type === "lparen" && t.fn && t.match !== undefined) {
        const len = t.match - t.fnIndex + 1;
        if (len < 5) continue;
        // Only suggest a VAR when every occurrence runs in the same filter context:
        // inside CALCULATE, FILTER or an iterator the "same" expression can return a different value.
        const outer = sig[t.fnIndex].parents;
        if (!outer.every((p) => SCALAR_SAFE.includes(p))) continue;
        if (["BLANK", "TRUE", "FALSE", "TODAY", "NOW"].includes(t.fn)) continue;
        const key = sig.slice(t.fnIndex, t.match + 1).map((s) => (s.type === "ident" ? s.text.toUpperCase() : s.text)).join(" ");
        const entry = counts.get(key) || { count: 0, line: sig[t.fnIndex].line, len, start: t.fnIndex, end: t.match };
        entry.count++;
        counts.set(key, entry);
      }
    }
    const repeated = [...counts.entries()].filter(([, v]) => v.count >= 2).sort((a, b) => b[1].len - a[1].len);
    const reported = [];
    for (const [key, v] of repeated) {
      if (reported.some((r) => r.includes(key))) continue;
      reported.push(key);
      const shown = textOf(sig, v.start, v.end + 1);
      add({ id: "repeat", severity: "warning", line: v.line, title: "Same expression written " + v.count + " times",
        detail: "This part appears " + v.count + " times: " + (shown.length > 120 ? shown.slice(0, 117) + "..." : shown) + ". Store it once in a variable (VAR) and reuse it. The code gets shorter, and Power BI can calculate it once instead of " + v.count + " times. (A VAR is calculated once, where it is defined, so only move expressions that are not inside CALCULATE or an iterator.)",
        fix: "VAR Result = " + (shown.length > 80 ? shown.slice(0, 77) + "..." : shown) + "\nRETURN\n    ... use Result here ..." });
      if (reported.length >= 3) break;
    }

    const order = { error: 0, warning: 1, info: 2 };
    findings.sort((a, b) => order[a.severity] - order[b.severity] || a.line - b.line);
    return findings;
  }

  // Index of the "=" or ":=" that separates "Measure Name =" from the expression, or -1.
  function headerEquals(sig) {
    for (let k = 0; k < sig.length; k++) {
      const t = sig[k];
      if (t.type === "op" && (t.text === "=" || t.text === ":=")) {
        if (k === 0) return -1;
        const before = sig.slice(0, k);
        const allNames = before.every((s) => s.type === "ident" || s.type === "column" || s.type === "table" || s.type === "number" || s.type === "unknown" || (s.type === "op" && s.text === "-"));
        const hasKeyword = before.some((s) => s.type === "ident" && ["VAR", "RETURN", "EVALUATE", "DEFINE", "MEASURE"].includes(s.text.toUpperCase()));
        return allNames && !hasKeyword ? k : -1;
      }
      if (t.type === "lparen" || t.type === "comma") return -1;
    }
    return -1;
  }

  // ---------------------------------------------------------------- formatter

  const KEYWORDS = ["VAR", "RETURN", "TRUE", "FALSE", "IN", "NOT", "DEFINE", "EVALUATE", "MEASURE", "ORDER", "BY", "ASC", "DESC", "START", "AT", "COLUMN", "TABLE"];
  const WIDTH = 80;
  const IND = "    ";

  // Build a tree: sequence = array of items. Item = token | { call: name|null, args: [sequence...], open, close }
  function buildTree(tokens) {
    const sig = tokens.filter((t) => t.type !== "ws" && t.type !== "nl");
    let pos = 0;
    function parseSeq(stopAtComma) {
      const seq = [];
      while (pos < sig.length) {
        const t = sig[pos];
        if (t.type === "rparen") break;
        if (t.type === "comma" && stopAtComma) break;
        if (t.type === "lparen") {
          const prev = seq[seq.length - 1];
          let name = null;
          if (prev && prev.type === "ident") { name = prev; seq.pop(); }
          pos++;
          const args = [];
          if (sig[pos] && sig[pos].type !== "rparen") {
            for (;;) {
              args.push(parseSeq(true));
              if (sig[pos] && sig[pos].type === "comma") { pos++; continue; }
              break;
            }
          }
          if (sig[pos] && sig[pos].type === "rparen") pos++;
          seq.push({ call: name, args });
          continue;
        }
        seq.push(t);
        pos++;
      }
      return seq;
    }
    const seq = [];
    for (;;) {
      seq.push(...parseSeq(false));
      if (pos >= sig.length) break;
      seq.push(sig[pos]); // stray ) or , at top level: keep it
      pos++;
    }
    return seq;
  }

  function tokText(t) {
    if (t.type === "ident") {
      const u = t.text.toUpperCase();
      return KEYWORDS.includes(u) ? u : t.text;
    }
    if (t.type === "op") {
      const u = t.text;
      return u;
    }
    return t.text;
  }

  const isOpTok = (x) => x && x.type === "op";
  // Table[Column] is written without a space
  const glued = (prev, x) => x && x.type === "column" && prev && (prev.type === "ident" || prev.type === "table");
  const hasComment = (seq) => seq.some((x) => (x.call !== undefined ? x.args.some(hasComment) : x.type === "comment"));

  function flatItem(x) {
    if (x.call !== undefined) {
      const name = x.call ? x.call.text.toUpperCase() + " " : "";
      if (!x.args.length) return name + "()";
      return name + "( " + x.args.map(flatSeq).join(", ") + " )";
    }
    return tokText(x);
  }

  function flatSeq(seq) {
    let out = "";
    for (let k = 0; k < seq.length; k++) {
      const x = seq[k];
      const s = flatItem(x);
      if (k === 0) { out = s; continue; }
      const prev = seq[k - 1];
      const unaryPrev = isOpTok(prev) && (prev.text === "-" || prev.text === "+") && (k - 1 === 0 || isOpTok(seq[k - 2]));
      const braces = (isOpTok(prev) && prev.text === "{") || (isOpTok(x) && x.text === "}");
      out += unaryPrev || braces || glued(prev, x) ? s : " " + s;
    }
    return out;
  }

  // Render a sequence at the given indent level. Returns lines (without trailing newline).
  function renderSeq(seq, indent) {
    const pad = IND.repeat(indent);
    if (!hasComment(seq) && !hasVar(seq)) {
      const flat = flatSeq(seq);
      if (pad.length + flat.length <= WIDTH) return [pad + flat];
    }
    // VAR / RETURN blocks
    if (hasVar(seq)) return renderVarBlock(seq, indent);

    const lines = [];
    let cur = null; // current line being built
    const flush = () => { if (cur !== null) { lines.push(cur); cur = null; } };
    for (let k = 0; k < seq.length; k++) {
      const x = seq[k];
      if (x.type === "comment") {
        if (cur !== null && x.text.startsWith("/*") === false) { cur += " " + x.text; flush(); }
        else { flush(); lines.push(pad + x.text); }
        continue;
      }
      if (x.call !== undefined) {
        const flat = flatItem(x);
        const prefix = cur === null ? pad : cur + " ";
        if (!x.args.some(hasComment) && !x.args.some(hasVar) && prefix.length + flat.length <= WIDTH) {
          cur = prefix + flat;
          continue;
        }
        const name = x.call ? x.call.text.toUpperCase() + " (" : "(";
        lines.push(prefix + name);
        cur = null;
        x.args.forEach((arg, idx) => {
          const argLines = renderSeq(arg, indent + 1);
          if (idx < x.args.length - 1) argLines[argLines.length - 1] += ",";
          lines.push(...argLines);
        });
        cur = pad + ")";
        continue;
      }
      // break long operator chains before && / || / + etc. when the line is already long
      const s = tokText(x);
      if (cur === null) { cur = pad + s; continue; }
      const prev = seq[k - 1];
      const unaryPrev = isOpTok(prev) && (prev.text === "-" || prev.text === "+") && (k - 1 === 0 || isOpTok(seq[k - 2]));
      if (isOpTok(x) && ["&&", "||"].includes(x.text) && cur.length > pad.length + 20) { flush(); cur = pad + s; continue; }
      cur += unaryPrev || glued(prev, x) ? s : " " + s;
    }
    flush();
    return lines.length ? lines : [pad];
  }

  function hasVar(seq) {
    return seq.some((x) => x.type === "ident" && x.text.toUpperCase() === "VAR");
  }

  function renderVarBlock(seq, indent) {
    const pad = IND.repeat(indent);
    const lines = [];
    // split into statements on VAR / RETURN keywords
    const parts = [];
    let current = { kw: null, items: [] };
    for (const x of seq) {
      const u = x.type === "ident" ? x.text.toUpperCase() : null;
      if (u === "VAR" || u === "RETURN") {
        if (current.kw || current.items.length) parts.push(current);
        current = { kw: u, items: [] };
      } else current.items.push(x);
    }
    parts.push(current);
    for (const p of parts) {
      if (p.kw === "VAR") {
        // VAR Name = expression
        const eq = p.items.findIndex((x) => isOpTok(x) && x.text === "=");
        if (eq === -1) { lines.push(...renderSeq(p.items, indent).map((l, i) => (i === 0 ? pad + "VAR " + l.trimStart() : l))); continue; }
        const nameItems = p.items.slice(0, eq);
        const leadingComments = [];
        while (nameItems.length && nameItems[0].type === "comment") leadingComments.push(nameItems.shift());
        leadingComments.forEach((c) => lines.push(pad + c.text));
        const nameText = flatSeq(nameItems);
        const expr = p.items.slice(eq + 1);
        const trailing = [];
        while (expr.length && expr[expr.length - 1].type === "comment") trailing.unshift(expr.pop());
        const flat = flatSeq(expr);
        const head = pad + "VAR " + nameText + " =";
        if (!hasComment(expr) && !hasVar(expr) && head.length + 1 + flat.length <= WIDTH) lines.push(head + " " + flat);
        else { lines.push(head); lines.push(...renderSeq(expr, indent + 1)); }
        trailing.forEach((c) => lines.push(pad + c.text));
      } else if (p.kw === "RETURN") {
        lines.push(pad + "RETURN");
        const leading = [];
        const items = p.items.slice();
        while (items.length && items[0].type === "comment") leading.push(items.shift());
        leading.forEach((c) => lines.push(pad + IND + c.text));
        if (items.length) lines.push(...renderSeq(items, indent + 1));
      } else if (p.items.length) {
        lines.push(...renderSeq(p.items, indent));
      }
    }
    return lines;
  }

  function format(src) {
    const { tokens, errors } = tokenize(src);
    if (errors.length) return { ok: false, text: src, reason: "Fix the syntax problems first, then format." };
    const sig = tokens.filter((t) => t.type !== "ws" && t.type !== "nl");
    if (!sig.length) return { ok: true, text: "" };
    // Check parens balance (formatter needs a well-formed tree)
    let depth = 0;
    for (const t of sig) {
      if (t.type === "lparen") depth++;
      if (t.type === "rparen") depth--;
      if (depth < 0) break;
    }
    if (depth !== 0) return { ok: false, text: src, reason: "Fix the unbalanced brackets first, then format." };

    const h = headerEquals(sig.filter((t) => t.type !== "comment"));
    let headerText = "";
    let body = tokens;
    if (h !== -1) {
      // find the h-th significant non-comment token in the original token list
      let count = -1;
      let cut = -1;
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (isTrivia(t)) continue;
        count++;
        if (count === h) { cut = i; break; }
      }
      const headTokens = tokens.slice(0, cut).filter((t) => t.type !== "ws" && t.type !== "nl");
      headerText = headTokens.map(tokText).join(" ").replace(/ (\[)/g, "$1") + " " + tokens[cut].text;
      body = tokens.slice(cut + 1);
    }
    const tree = buildTree(body);
    const lines = renderSeq(tree, h !== -1 ? 1 : 0);
    const text = (headerText ? headerText + "\n" : "") + lines.map((l) => l.replace(/\s+$/, "")).join("\n");
    return { ok: true, text };
  }

  // Heuristic: does this look like DAX at all (vs Power Query M, SQL, Python)?
  function detectLanguage(src) {
    const s = src.trim();
    if (!s) return "empty";
    if (/^\s*let\b[\s\S]*\bin\b/i.test(s) && /#"|Table\.|each\s/.test(s)) return "m";
    if (/^\s*(select|with)\b[\s\S]*\bfrom\b/i.test(s)) return "sql";
    return "dax";
  }

  const api = { tokenize, analyze, check, format, detectLanguage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DaxDoctor = api;
})(typeof window !== "undefined" ? window : globalThis);
