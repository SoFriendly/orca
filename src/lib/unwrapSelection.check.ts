// Self-check: node --experimental-strip-types src/lib/unwrapSelection.check.ts
import assert from "node:assert/strict";
import { unwrapSelection } from "./unwrapSelection.ts";

const cols = 40;

// Word-wrapped command with indented continuation -> one line
assert.equal(
  unwrapSelection("  npm run build -- --mode production\n  --outDir dist/release", cols),
  "  npm run build -- --mode production --outDir dist/release",
);

// Long token cut at the edge -> joined with no space
assert.equal(
  unwrapSelection("https://example.com/a/very/long/path/tha\nt/keeps/going", cols), // row 1 is exactly 40
  "https://example.com/a/very/long/path/that/keeps/going",
);

// Short lines are real line breaks
assert.equal(unwrapSelection("git add .\ngit commit", cols), "git add .\ngit commit");

// Blank line between paragraphs survives
assert.equal(unwrapSelection("one\n\ntwo", cols), "one\n\ntwo");

// Selection starting mid-row: startCol makes the first row count as full
assert.equal(
  unwrapSelection("run build -- --mode production\n  --outDir dist/release", cols, 6),
  "run build -- --mode production --outDir dist/release",
);

// Table borders are left alone
const border = "│" + "─".repeat(38) + "│";
assert.equal(unwrapSelection(`${border}\n${border}`, cols), `${border}\n${border}`);

console.log("unwrapSelection ok");
