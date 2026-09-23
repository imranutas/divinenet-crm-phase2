'use strict';
const { randomUUID } = require('node:crypto');

function createTextRuntimeGuard(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS text_runtime_guard (
    id INTEGER PRIMARY KEY CHECK(id=1),
    state TEXT NOT NULL CHECK(state IN ('Ready','Generating','NeedsReset')),
    operation_id TEXT,
    updated_at TEXT NOT NULL
  )`);
  db.prepare("INSERT OR IGNORE INTO text_runtime_guard VALUES (1,'Ready',NULL,?)").run(new Date().toISOString());
  const state = () => db.prepare('SELECT state FROM text_runtime_guard WHERE id=1').get().state;
  const begin = db.transaction(() => {
    if (state() !== 'Ready') return null;
    const operation = randomUUID();
    db.prepare("UPDATE text_runtime_guard SET state='Generating',operation_id=?,updated_at=? WHERE id=1")
      .run(operation, new Date().toISOString());
    return operation;
  });
  const settle = (operation, nextState) => db.prepare('UPDATE text_runtime_guard SET state=?,operation_id=NULL,updated_at=? WHERE id=1 AND operation_id=?')
    .run(nextState, new Date().toISOString(), operation);
  return { state, begin: () => begin.immediate(), complete: operation => settle(operation, 'Ready'), uncertain: operation => settle(operation, 'NeedsReset') };
}
module.exports = { createTextRuntimeGuard };
