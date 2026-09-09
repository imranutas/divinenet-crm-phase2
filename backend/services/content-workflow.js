const CONTENT_SERVICE_UNAVAILABLE =
  "AI content provider is not configured";

function createContentWorkflow(options = {}) {
  const provider = options.provider || null;

  async function generateContent(request) {
    if (!provider) {
      return {
        success: false,
        statusCode: 503,
        message: CONTENT_SERVICE_UNAVAILABLE
      };
    }

    if (
      !request ||
      !request.prompt ||
      String(request.prompt).trim() === ""
    ) {
      return {
        success: false,
        statusCode: 400,
        message: "Prompt is required"
      };
    }

    try {
      const result = await provider.generate({
        prompt: String(request.prompt).trim(),
        brand: request.brand
          ? String(request.brand).trim()
          : "",
        channel: request.channel || null
      });

      return {
        success: true,
        statusCode: 200,
        data: {
          content: result.content,
          provider: result.provider,
          status: "Draft",
          requiresHumanApproval: true
        }
      };
    } catch (error) {
      return {
        success: false,
        statusCode: 502,
        message: "AI content provider request failed"
      };
    }
  }

  return {
    generateContent
  };
}

module.exports = {
  CONTENT_SERVICE_UNAVAILABLE,
  createContentWorkflow
};