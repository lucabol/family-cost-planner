import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("styles.css", "utf8");

test("evidence disclosure controls the rendered evidence rows", () => {
  assert.match(
    html,
    /id="expandAllButton"[^>]*aria-expanded="false"[^>]*aria-controls="budgetRows"/
  );
  assert.match(app, /setAttribute\("aria-expanded", String\(state\.showAllEvidence\)\)/);
});

test("mobile evidence rows expose labels and remove desktop overflow", () => {
  assert.match(app, /data-label="Adopted default"/);
  assert.match(app, /data-label="Evidence basis"/);
  assert.match(app, /data-label="Your monthly input"/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.table-wrap \{[\s\S]*?overflow: visible;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?table \{[\s\S]*?min-width: 0;/);
  assert.match(css, /tbody td::before \{[\s\S]*?content: attr\(data-label\);/);
});

test("evidence details retain linked source context and reliability", () => {
  assert.match(app, /class="evidence-reliability"/);
  assert.match(app, /primarySource\.url/);
  assert.match(css, /\.evidence-detail a,[\s\S]*?overflow-wrap: anywhere;/);
});
