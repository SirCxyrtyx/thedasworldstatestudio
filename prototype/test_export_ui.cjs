// Completed exports remain successful when a preference could not be saved.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/gui/app.js', 'utf8');
const elements = new Map();
const $ = id => {
  if (!elements.has(id)) elements.set(id, {value: 'Test', hidden: true, open: true,
    close() { this.open = false; }});
  return elements.get(id);
};
const state = {draft: {profile_id: 'saved', revision: 2}, preview: {can_export: true}, showDiagnostics: false};
const messages = [];
const result = {path: 'C:/Exports/Test.fbmod', report_path: 'C:/Exports/Test.report.json',
  directory: 'C:/Exports', revision: 2, download_id: 'export-id',
  warnings: ['The FBMOD was saved, but the export folder could not be remembered.']};
let fail = false;
const context = vm.createContext({$, state, save: async () => true,
  api: async () => { if (fail) throw Error('Disk full'); return result; },
  busy: value => { state.busy = value; }, toast: (...args) => messages.push(args)});
vm.runInContext(source.slice(source.indexOf('async function exportMod('),
  source.indexOf('function renderFbmodIcon(')), context);
(async () => {
  await context.exportMod();
  assert.equal(messages.length, 1);
  assert.equal(messages[0][0], 'FBMOD saved · Revision 2');
  assert.match(messages[0][1], /could not be remembered/);
  assert.equal(messages[0][2], false, 'preference warning must not mark a completed export as failed');
  assert.equal(messages[0][3][0].label, 'Open export folder');
  assert.equal($('fbmod-export-dialog').open, false);
  assert.equal(state.exportDirectory, result.directory);
  assert.equal(state.busy, false);
  delete result.warnings;
  await context.exportMod();
  assert.equal(messages[1][1], result.path, 'responses without warnings remain compatible');
  fail = true; $('fbmod-export-dialog').open = true;
  await context.exportMod();
  assert.equal(messages.length, 2, 'failed file writes must not show a success toast');
  assert.equal($('fbmod-export-dialog').open, true);
  assert.equal($('fbmod-export-error').hidden, false);
  assert.equal($('fbmod-export-error').textContent, 'Disk full');
  assert.equal(state.busy, false);
  console.log('PASS: completed-export warning, folder action, legacy response and genuine write failure');
})().catch(error => { console.error(error); process.exitCode = 1; });
