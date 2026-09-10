const { createDirectoryRepository } = require('./directoryRepository');
function createCampaignRepository(db) {
  const labels = createDirectoryRepository(db);
  const query = "SELECT c.*,COALESCE(cl.name,'') AS client,COALESCE(b.name,'') AS brand FROM campaigns c LEFT JOIN clients cl ON cl.id=c.client_id LEFT JOIN brands b ON b.id=c.brand_id ";
  function getAll() { return db.prepare(query + ' ORDER BY c.created_at DESC,c.id').all(); }
  function getById(id) { return db.prepare(query + ' WHERE c.id=?').get(id); }
  function values(c) { return [c.campaignName,c.prompt,labels.resolveClient(c.clientId,c.client),labels.resolveBrand(c.brandId,c.brand),c.objective||'',c.targetAudience||'',c.startDate,c.endDate,c.budget??null,c.channel,c.status||'Draft',c.updatedAt]; }
  const create = db.transaction(c => {
    const v=values(c);
    db.prepare('INSERT INTO campaigns(campaign_name,prompt,client_id,brand_id,objective,target_audience,start_date,end_date,budget,channel,status,updated_at,id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...v,c.id,c.createdAt);
    return getById(c.id);
  });
  const update = db.transaction((id,c) => {
    if (!getById(id)) return null;
    db.prepare('UPDATE campaigns SET campaign_name=?,prompt=?,client_id=?,brand_id=?,objective=?,target_audience=?,start_date=?,end_date=?,budget=?,channel=?,status=?,updated_at=? WHERE id=?').run(...values(c),id);
    return getById(id);
  });
  function remove(id) { return db.prepare('DELETE FROM campaigns WHERE id=?').run(id).changes > 0; }
  return { getAll,getById,create,update,remove };
}
module.exports={createCampaignRepository};
