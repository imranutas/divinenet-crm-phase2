function simulateMetaPublish(platform, content) {
  const approvedPlatforms = ["Facebook", "Instagram"];

  if (!approvedPlatforms.includes(platform)) {
    return {
      testMode: true,
      success: false,
      message: "Platform must be Facebook or Instagram"
    };
  }

  return {
    testMode: true,
    success: true,
    platform,
    content,
    published: false,
    message: "Test completed - no live publishing occurred"
  };
}

module.exports = {
  simulateMetaPublish
};
