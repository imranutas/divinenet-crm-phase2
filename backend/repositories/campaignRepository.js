function createCampaignRepository(db) {
  function getAll() {
    return db.prepare(`
      SELECT * FROM campaigns
      ORDER BY created_at DESC
    `).all();
  }

  function getById(id) {
    return db.prepare(`
      SELECT * FROM campaigns
      WHERE id = ?
    `).get(id);
  }

  function create(campaign) {
    const statement = db.prepare(`
      INSERT INTO campaigns (
        id,
        campaign_name,
        prompt,
        client,
        brand,
        objective,
        target_audience,
        start_date,
        end_date,
        budget,
        channel,
        status,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    statement.run(
      campaign.id,
      campaign.campaignName,
      campaign.prompt,
      campaign.client || "",
      campaign.brand || "",
      campaign.objective || "",
      campaign.targetAudience || "",
      campaign.startDate,
      campaign.endDate,
      campaign.budget ?? null,
      campaign.channel,
      campaign.status || "Draft",
      campaign.createdAt,
      campaign.updatedAt
    );

    return getById(campaign.id);
  }

  function update(id, campaign) {
    const statement = db.prepare(`
      UPDATE campaigns
      SET campaign_name = ?,
          prompt = ?,
          client = ?,
          brand = ?,
          objective = ?,
          target_audience = ?,
          start_date = ?,
          end_date = ?,
          budget = ?,
          channel = ?,
          status = ?,
          updated_at = ?
      WHERE id = ?
    `);

    const result = statement.run(
      campaign.campaignName,
      campaign.prompt,
      campaign.client || "",
      campaign.brand || "",
      campaign.objective || "",
      campaign.targetAudience || "",
      campaign.startDate,
      campaign.endDate,
      campaign.budget ?? null,
      campaign.channel,
      campaign.status || "Draft",
      campaign.updatedAt,
      id
    );

    if (result.changes === 0) {
      return null;
    }

    return getById(id);
  }

  function remove(id) {
    const result = db
      .prepare("DELETE FROM campaigns WHERE id = ?")
      .run(id);

    return result.changes > 0;
  }

  return {
    getAll,
    getById,
    create,
    update,
    remove
  };
}

module.exports = {
  createCampaignRepository
};