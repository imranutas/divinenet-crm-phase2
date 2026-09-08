function createLeadRepository(db) {
  function getAll(campaignId) {
    if (campaignId) {
      return db
        .prepare(`
          SELECT * FROM leads
          WHERE campaign_id = ?
          ORDER BY created_at DESC
        `)
        .all(campaignId);
    }

    return db
      .prepare(`
        SELECT * FROM leads
        ORDER BY created_at DESC
      `)
      .all();
  }

  function getById(id) {
    return db
      .prepare(`
        SELECT * FROM leads
        WHERE id = ?
      `)
      .get(id);
  }

  function create(lead) {
    const statement = db.prepare(`
      INSERT INTO leads (
        id,
        campaign_id,
        name,
        email,
        phone,
        source_platform,
        consent_status,
        stage,
        score,
        score_policy_version,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    statement.run(
      lead.id,
      lead.campaignId,
      lead.name,
      lead.email,
      lead.phone || "",
      lead.sourcePlatform,
      lead.consentStatus,
      lead.stage || "New",
      lead.score ?? null,
      lead.scorePolicyVersion ?? null,
      lead.createdAt,
      lead.updatedAt
    );

    return getById(lead.id);
  }

  function update(id, lead) {
    const statement = db.prepare(`
      UPDATE leads
      SET campaign_id = ?,
          name = ?,
          email = ?,
          phone = ?,
          source_platform = ?,
          consent_status = ?,
          stage = ?,
          score = ?,
          score_policy_version = ?,
          updated_at = ?
      WHERE id = ?
    `);

    const result = statement.run(
      lead.campaignId,
      lead.name,
      lead.email,
      lead.phone || "",
      lead.sourcePlatform,
      lead.consentStatus,
      lead.stage || "New",
      lead.score ?? null,
      lead.scorePolicyVersion ?? null,
      lead.updatedAt,
      id
    );

    if (result.changes === 0) {
      return null;
    }

    return getById(id);
  }

  function updateStage(id, stage, updatedAt) {
    const currentLead = getById(id);

    if (!currentLead) {
      return null;
    }

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO lead_stage_history (
          id,
          lead_id,
          from_stage,
          to_stage,
          changed_at
        )
        VALUES (?, ?, ?, ?, ?)
      `).run(
        `LSH-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        id,
        currentLead.stage,
        stage,
        updatedAt
      );

      db.prepare(`
        UPDATE leads
        SET stage = ?,
            updated_at = ?
        WHERE id = ?
      `).run(stage, updatedAt, id);
    });

    transaction();

    return getById(id);
  }

  function remove(id) {
    const result = db
      .prepare("DELETE FROM leads WHERE id = ?")
      .run(id);

    return result.changes > 0;
  }

  function countByCampaignId(campaignId) {
    const result = db
      .prepare(`
        SELECT COUNT(*) AS total
        FROM leads
        WHERE campaign_id = ?
      `)
      .get(campaignId);

    return result.total;
  }

  return {
    getAll,
    getById,
    create,
    update,
    updateStage,
    remove,
    countByCampaignId
  };
}

module.exports = {
  createLeadRepository
};