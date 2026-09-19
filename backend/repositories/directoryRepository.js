const { randomUUID } = require('node:crypto');
function createDirectoryRepository(db) {
  function list(table) { return db.prepare('SELECT id,name FROM ' + table + ' ORDER BY name,id').all(); }
  function create(table, name) {
    if (typeof name !== 'string' || !name.trim() || name.length > 200) throw Object.assign(new Error('Name must contain 1 to 200 characters'), { status: 400 });
    const existing = db.prepare('SELECT id,name FROM ' + table + ' WHERE name=?').get(name.trim());
    if (existing) return existing;
    const id = randomUUID();
    db.prepare('INSERT INTO ' + table + '(id,name) VALUES (?,?)').run(id, name.trim());
    return { id, name: name.trim() };
  }
  function resolve(table, id, name) {
    if (id) {
      const row = db.prepare('SELECT id,name FROM ' + table + ' WHERE id=?').get(id);
      if (!row) throw Object.assign(new Error('Selected ' + table + ' record does not exist'), { status: 400 });
      if (name && name.trim() !== row.name) throw Object.assign(new Error('Selected record and name do not match'), { status: 400 });
      return id;
    }
    return name && name.trim() ? create(table, name).id : null;
  }
  return { listClients: () => list('clients'), listBrands: () => list('brands'),
    createClient: name => create('clients', name), createBrand: name => create('brands', name),
    resolveClient: (id,name) => resolve('clients',id,name), resolveBrand: (id,name) => resolve('brands',id,name) };
}
module.exports = { createDirectoryRepository };
