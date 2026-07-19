// Combines rule-engine flags with the ML probability into one final score
// and decision. No single signal is judge/jury/executioner (see design doc
// section 2) - rule flags and the model both contribute, and each rule flag
// nudges the score even if the model itself is confident the transaction is clean.
const RULE_WEIGHT = 0.15; // additive bump per rule flag
const BLOCK_THRESHOLD = 0.85;
const REVIEW_THRESHOLD = 0.5;

function decide({ mlProbability, ruleFlags }) {
  const ruleBoost = Math.min(ruleFlags.length * RULE_WEIGHT, 0.45);
  const finalScore = Math.min(mlProbability + ruleBoost, 1);

  let decision = "APPROVE";
  if (finalScore >= BLOCK_THRESHOLD) decision = "BLOCK";
  else if (finalScore >= REVIEW_THRESHOLD) decision = "REVIEW";

  return { finalScore, decision };
}

module.exports = { decide };
