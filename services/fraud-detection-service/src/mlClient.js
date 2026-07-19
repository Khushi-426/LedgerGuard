const axios = require("axios");

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:5001";

const client = axios.create({ baseURL: ML_SERVICE_URL, timeout: 3000 });

/**
 * Calls the ML Prediction Service with the transaction's raw feature vector
 * (Time, V1..V28, Amount) and returns a fraud probability in [0, 1].
 * On failure, fails safe by returning a neutral probability and flagging the
 * outage in the result - a down ML service should degrade the pipeline to
 * rule-engine-only, not crash it.
 */
async function predict(sourceFeatures) {
  try {
    const { data } = await client.post("/predict", { features: sourceFeatures });
    return { probability: data.fraud_probability, modelVersion: data.model_version, ok: true };
  } catch (err) {
    console.error("[fraud-detection-service] ML service call failed, degrading to rule-engine-only", err.message);
    return { probability: 0.5, modelVersion: "unavailable", ok: false };
  }
}

module.exports = { predict };
