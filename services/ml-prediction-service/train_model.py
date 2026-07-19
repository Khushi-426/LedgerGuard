"""
Trains the fraud-probability model used by the ML Prediction Service.

Dataset: Kaggle "Credit Card Fraud Detection" (mlg-ulb/creditcardfraud).
This script intentionally does NOT download the dataset automatically -
Kaggle's terms of use require an authenticated, accepted-rules download.

Usage:
    1. Download creditcard.csv from
       https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud
    2. Place it at services/ml-prediction-service/data/creditcard.csv
    3. Run:  python train_model.py
    4. This produces model.joblib in this directory, which app.py loads.

Model choice: XGBoost gradient-boosted trees. This dataset is tabular,
numeric, and severely imbalanced (0.172% positive) - exactly the profile
where gradient-boosted trees consistently outperform deep learning, and
it's what most public benchmarks on this dataset converge on. See the
system design doc, section 3.5, for the fuller justification.
"""
import os
import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import average_precision_score, classification_report
from xgboost import XGBClassifier

DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "creditcard.csv")
MODEL_PATH = os.path.join(os.path.dirname(__file__), "model.joblib")
MODEL_VERSION = "xgb-v1"

FEATURE_COLUMNS = ["Time"] + [f"V{i}" for i in range(1, 29)] + ["Amount"]


def main():
    if not os.path.exists(DATA_PATH):
        raise FileNotFoundError(
            f"Dataset not found at {DATA_PATH}.\n"
            "Download creditcard.csv from "
            "https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud "
            "and place it there before running this script."
        )

    df = pd.read_csv(DATA_PATH)
    X = df[FEATURE_COLUMNS]
    y = df["Class"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )

    # scale_pos_weight compensates for the ~580:1 class imbalance so the
    # model doesn't just learn to always predict "not fraud".
    scale_pos_weight = (y_train == 0).sum() / (y_train == 1).sum()

    model = XGBClassifier(
        n_estimators=300,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=scale_pos_weight,
        eval_metric="aucpr",
        random_state=42,
        n_jobs=-1,
    )

    model.fit(X_train, y_train)

    probs = model.predict_proba(X_test)[:, 1]
    preds = (probs >= 0.5).astype(int)

    print("Average precision (PR-AUC):", average_precision_score(y_test, probs))
    print(classification_report(y_test, preds, digits=4))

    joblib.dump({"model": model, "features": FEATURE_COLUMNS, "version": MODEL_VERSION}, MODEL_PATH)
    print(f"Saved model to {MODEL_PATH}")


if __name__ == "__main__":
    main()
