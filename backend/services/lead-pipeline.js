const PIPELINE_VERSION = "development-pipeline-v1";

const ALLOWED_TRANSITIONS = {
  New: ["Contacted"],
  Contacted: ["Qualified"],
  Qualified: []
};

function validateStageTransition(
  currentStage,
  requestedStage
) {
  if (!currentStage || !requestedStage) {
    return {
      allowed: false,
      message:
        "Current stage and requested stage are required"
    };
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      ALLOWED_TRANSITIONS,
      currentStage
    )
  ) {
    return {
      allowed: false,
      message: "Current lead stage is not supported"
    };
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      ALLOWED_TRANSITIONS,
      requestedStage
    )
  ) {
    return {
      allowed: false,
      message: "Requested lead stage is not supported"
    };
  }

  if (currentStage === requestedStage) {
    return {
      allowed: false,
      message: "Lead is already in the requested stage"
    };
  }

  const allowedNextStages =
    ALLOWED_TRANSITIONS[currentStage];

  if (
    !allowedNextStages.includes(
      requestedStage
    )
  ) {
    return {
      allowed: false,
      message:
        `Invalid stage transition from ${currentStage} to ${requestedStage}`
    };
  }

  return {
    allowed: true,
    pipelineVersion: PIPELINE_VERSION
  };
}

module.exports = {
  PIPELINE_VERSION,
  ALLOWED_TRANSITIONS,
  validateStageTransition
};
