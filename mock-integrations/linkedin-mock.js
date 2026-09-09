function simulateLinkedInPublish(content) {
  return {
    testMode: true,
    success: true,
    platform: "LinkedIn",
    content,
    published: false,
    message: "Test completed - no live publishing occurred"
  };
}

module.exports = {
  simulateLinkedInPublish
};
