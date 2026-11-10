// Run with: node dax-doctor/test/engine.test.js
const assert = require("assert");
const D = require("../engine.js");
const ids = (src) => D.check(src).map((f) => f.id);
let passed = 0;
function t(name, fn) { try { fn(); passed++; console.log("ok   " + name); } catch (e) { console.log("FAIL " + name + "\n     " + e.message); process.exitCode = 1; } }

t("division flagged", () => assert(ids("Margin = [Profit] / [Sales]").includes("divide")));
t("division by constant not flagged", () => assert(!ids("Half = [Sales] / 2").includes("divide")));
t("IFERROR flagged", () => assert(ids("X = IFERROR([A]/[B], 0)").includes("iferror")));
t("FILTER whole table in CALCULATE", () => {
  const f = D.check("Red Sales = CALCULATE([Sales], FILTER(Sales, Sales[Color] = \"Red\"))").find((x) => x.id === "filter-table");
  assert(f && f.severity === "warning");
});
t("FILTER on ALL(column) not flagged", () => assert(!ids("X = CALCULATE([Sales], FILTER(ALL(Sales[Color]), Sales[Color] = \"Red\"))").includes("filter-table")));
t("SUMX FILTER", () => assert(ids("X = SUMX(FILTER(Sales, Sales[Qty] > 1), Sales[Amount])").includes("iterator-filter")));
t("nested IF", () => assert(ids("X = IF([a]>1, 1, IF([a]>2, 2, IF([a]>3, 3, 4)))").includes("nested-if")));
t("repeated expression", () => assert(ids("X = IF(SUM(Sales[Amount]) > 0, SUM(Sales[Amount]) * 2, 0)").includes("repeat")));
t("no VAR advice for repeats inside CALCULATE", () => assert(!ids("X = CALCULATE(SUM(Sales[Amount]), Sales[Color]=\"Red\") - CALCULATE(SUM(Sales[Amount]), Sales[Color]=\"Blue\")").includes("repeat")));
t("EARLIER", () => assert(ids("R = COUNTROWS(FILTER(T, T[v] > EARLIER(T[v])))").includes("earlier")));
t("+ 0", () => assert(ids("X = [Sales] + 0").includes("force-zero")));
t("COALESCE 0", () => assert(ids("X = COALESCE([Sales], 0)").includes("force-zero")));
t("= BLANK()", () => assert(ids("X = IF([Sales] = BLANK(), 1, 2)").includes("blank-compare")));
t("SUMMARIZE add columns", () => assert(ids("T = SUMMARIZE(Sales, Product[Cat], \"Tot\", SUM(Sales[Amount]))").includes("summarize-columns")));
t("HASONEVALUE", () => assert(ids("X = IF(HASONEVALUE(P[C]), VALUES(P[C]))").includes("selectedvalue")));
t("unclosed paren", () => assert(ids("X = SUM(Sales[Amount]").includes("syntax")));
t("extra paren", () => assert(ids("X = SUM(Sales[Amount]))").includes("syntax")));
t("unclosed bracket", () => assert(ids("X = SUM(Sales[Amount)").includes("syntax")));
t("division inside a string is ignored", () => assert(!ids("X = \"a/b\" & \"c\"").includes("divide")));
t("division in comment is ignored", () => assert(!ids("X = [A] // a/b\n+ 1").includes("divide")));
t("clean measure has no warnings", () => {
  const f = D.check("Total Sales = SUM ( Sales[Amount] )").filter((x) => x.severity !== "info");
  assert.deepStrictEqual(f, []);
});
t("format short", () => assert.strictEqual(D.format("Total Sales = sum(Sales[Amount])").text, "Total Sales =\n    SUM ( Sales[Amount] )"));
t("format VAR", () => {
  const out = D.format("M = var a = sum(Sales[Amount]) var b = [Cost] return divide(a-b, a)").text;
  assert.strictEqual(out, "M =\n    VAR a = SUM ( Sales[Amount] )\n    VAR b = [Cost]\n    RETURN\n        DIVIDE ( a - b, a )");
});
t("format long call breaks", () => {
  const out = D.format("X = CALCULATE([Total Sales Amount], FILTER(ALL('Product Category'[Category Name]), 'Product Category'[Category Name] = \"Bikes\"), USERELATIONSHIP(Sales[ShipDate], 'Date'[Date]))").text;
  assert(out.includes("CALCULATE (\n"), out);
  assert(out.split("\n").every((l) => l.length <= 80), out);
});
t("format keeps comments", () => {
  const out = D.format("X = // total\nSUM(Sales[Amount]) /* end */").text;
  assert(out.includes("// total") && out.includes("/* end */"), out);
});
t("format unary minus", () => assert.strictEqual(D.format("X = -1 * [A]").text, "X =\n    -1 * [A]"));
t("format is idempotent", () => {
  const src = "X = CALCULATE([Total Sales Amount], FILTER(ALL('Product Category'[Category Name]), 'Product Category'[Category Name] = \"Bikes\"), USERELATIONSHIP(Sales[ShipDate], 'Date'[Date]))";
  const once = D.format(src).text;
  assert.strictEqual(D.format(once).text, once);
});
t("format refuses broken code", () => assert.strictEqual(D.format("X = SUM(").ok, false));
t("format a bare expression without header", () => assert.strictEqual(D.format("sum(Sales[Amount])").text, "SUM ( Sales[Amount] )"));
t("detect Power Query", () => assert.strictEqual(D.detectLanguage('let Source = Excel.Workbook(x), #"Changed" = Table.TransformColumnTypes(Source, {}) in #"Changed"'), "m"));
console.log("\n" + passed + " passed");
