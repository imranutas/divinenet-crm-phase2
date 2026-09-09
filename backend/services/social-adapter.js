const SOCIAL_SERVICE_UNAVAILABLE =
  "Social publishing integration is not configured";

const SUPPORTED_PLATFORMS = [
  "Facebook",
  "Instagram",
  "LinkedIn"
];

function createSocialAdapter(options = {}) {
  const provider = options.provider || null;

  async function publishContent(request) {
    if (!provider) {
      return {
        success: false,
        statusCode: 503,
        message: SOCIAL_SERVICE_UNAVAILABLE
      };
    }

    if (
      !request ||
      !request.platform ||
      String(request.platform).trim() === ""
    ) {
      return {
        success: false,
        statusCode: 400,
        message: "Platform is required"
      };
    }

    if (
      !SUPPORTED_PLATFORMS.includes(
        request.platform
      )
    ) {
      return {
        success: false,
        statusCode: 400,
        message:
          "Platform must be Facebook, Instagram or LinkedIn"
      };
    }

    if (
      !request.content ||
      String(request.content).trim() === ""
    ) {
      return {
        success: false,
        statusCode: 400,
        message: "Content is required"
      };
    }

    try {
      const result = await provider.publish({
        platform: request.platform,
        content: String(request.content).trim()
      });

      return {
        success: true,
        statusCode: 200,
        data: {
          ...result,
          platform: request.platform
        }
      };
    } catch (error) {
      return {
        success: false,
        statusCode: 502,
        message:
          "Social publishing provider request failed"
      };
    }
  }

  return {
    publishContent
  };
}

module.exports = {
  SOCIAL_SERVICE_UNAVAILABLE,
  SUPPORTED_PLATFORMS,
  createSocialAdapter
};