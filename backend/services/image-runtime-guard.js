function createImageRuntimeGuard(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ai_runtime_guard(
    id INTEGER PRIMARY KEY CHECK(id=1),
    state TEXT NOT NULL CHECK(state IN ('Ready','Generating','NeedsReset')),
    updated_at TEXT NOT NULL
  );`);
  db.prepare("INSERT OR IGNORE INTO ai_runtime_guard VALUES (1,'Ready',?)").run(new Date().toISOString());
  const state = () => db.prepare('SELECT state FROM ai_runtime_guard WHERE id=1').get().state;
  const set = value => db.prepare('UPDATE ai_runtime_guard SET state=?,updated_at=? WHERE id=1').run(value, new Date().toISOString());
  const begin = db.transaction(() => {
    if (state() !== 'Ready') throw Object.assign(new Error(
      'The local image runtime may still be working. Stop the image runtime and CRM, then use the documented runtime reset before retrying.'
    ), { status: 503 });
    set('Generating');
  });
  return { state, begin, complete: () => set('Ready'), uncertain: () => set('NeedsReset') };
}

module.exports = { createImageRuntimeGuard };
