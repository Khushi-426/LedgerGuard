"""
ML Prediction Service - a thin, stable HTTP boundary around the fraud model.

Nothing upstream (the Node fraud-detection-service) needs to know this is
Python, or XGBoost, or that the model gets retrained monthly. That
boundary is the whole point - see system design doc, section 3.5 and 4.
"""
import os
import joblib
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Dict

MODEL_PATH = os.path.join(os.path.dirname(__file__), "model.joblib")

app = FastAPI(title="LedgerGuard ML Prediction Service", version="1.0.0")

_model_bundle = None


def load_model():
    global _model_bundle
    if os.path.exists(MODEL_PATH):
        _model_bundle = joblib.load(MODEL_PATH)
        print(f"Loaded model version {_model_bundle['version']}")
    else:
        print(
            "WARNING: model.joblib not found. Run train_model.py first. "
            "/predict will return 503 until a model is trained."
        )


@app.on_event("startup")
def on_startup():
    load_model()


class PredictRequest(BaseModel):
    # Raw Kaggle feature vector: Time, V1..V28, Amount. Missing fields
    # default to 0.0 so the endpoint degrades gracefully rather than 500ing
    # on a slightly incomplete payload from upstream.
    features: Dict[str, float] = Field(default_factory=dict)


class PredictResponse(BaseModel):
    fraud_probability: float
    model_version: str


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": _model_bundle is not None}


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    if _model_bundle is None:
        raise HTTPException(
            status_code=503,
            detail="model not loaded - run train_model.py and rebuild the image",
        )

    model = _model_bundle["model"]
    feature_order = _model_bundle["features"]

    row = np.array([[req.features.get(col, 0.0) for col in feature_order]])
    probability = float(model.predict_proba(row)[0, 1])

    return PredictResponse(fraud_probability=probability, model_version=_model_bundle["version"])
