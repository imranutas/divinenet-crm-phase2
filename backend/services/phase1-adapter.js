const PHASE1_UNAVAILABLE =
  "Phase 1 integration is not configured";

function createPhase1Adapter(options = {}) {
  const client = options.client || null;

  async function getCustomer(customerId) {
    if (!client) {
      return {
        success: false,
        statusCode: 503,
        message: PHASE1_UNAVAILABLE
      };
    }

    if (
      !customerId ||
      String(customerId).trim() === ""
    ) {
      return {
        success: false,
        statusCode: 400,
        message: "customerId is required"
      };
    }

    try {
      const customer = await client.getCustomer(
        String(customerId).trim()
      );

      if (!customer) {
        return {
          success: false,
          statusCode: 404,
          message: "Customer not found"
        };
      }

      return {
        success: true,
        statusCode: 200,
        data: customer
      };
    } catch (error) {
      return {
        success: false,
        statusCode: 502,
        message: "Phase 1 service request failed"
      };
    }
  }

  async function convertLead(lead) {
    if (!client) {
      return {
        success: false,
        statusCode: 503,
        message: PHASE1_UNAVAILABLE
      };
    }

    if (!lead || !lead.id) {
      return {
        success: false,
        statusCode: 400,
        message: "Lead is required"
      };
    }

    try {
      const result = await client.convertLead(lead);

      return {
        success: true,
        statusCode: 200,
        data: result
      };
    } catch (error) {
      return {
        success: false,
        statusCode: 502,
        message: "Phase 1 service request failed"
      };
    }
  }

  return {
    getCustomer,
    convertLead
  };
}

module.exports = {
  PHASE1_UNAVAILABLE,
  createPhase1Adapter
};
