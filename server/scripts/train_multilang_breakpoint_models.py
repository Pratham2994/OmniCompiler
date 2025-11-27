from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score

ROOT = Path(__file__).resolve().parents[1]
FEAT_DIR = ROOT / "data" / "features"
MODEL_DIR = ROOT / "data" / "model"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

LANG_FILES = {
    "cpp":        "cpp_training_features.csv",
    "python":     "python_training_features.csv",
    "java":       "java_training_features.csv",
    "javascript": "javascript_training_features.csv",
    "go":         "go_training_features.csv",
}

FEATURE_COLS = [
    "has_for", "has_while", "has_if", "has_else",
    "has_indexing", "has_comparison",
    "reason_count", "line_length",
    "num_ops", "num_parens", "num_tokens",
]

def train_for_lang(lang: str, filename: str):
    path = FEAT_DIR / filename
    if not path.exists():
        print(f"[{lang}] skipping, features file not found: {path}")
        return

    df = pd.read_csv(path)
    if df.empty:
        print(f"[{lang}] skipping, empty features file: {path}")
        return

    if "is_good_breakpoint" not in df.columns:
        print(f"[{lang}] ERROR: no is_good_breakpoint column in {path}")
        return

    X = df[FEATURE_COLS]
    y = df["is_good_breakpoint"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, random_state=42, stratify=y
    )

    clf = RandomForestClassifier(
        n_estimators=200,
        random_state=42,
    )
    clf.fit(X_train, y_train)

    y_pred = clf.predict(X_test)
    y_prob = clf.predict_proba(X_test)[:, 1]

    print(f"\n====== {lang.upper()} ======")
    print("Classification report:\n", classification_report(y_test, y_pred))
    try:
        auc = roc_auc_score(y_test, y_prob)
        print("ROC AUC:", auc)
    except ValueError:
        print("ROC AUC: cannot compute (only one class present in test set)")

    model_path = MODEL_DIR / f"{lang}_breakpoint_model.pkl"
    joblib.dump(clf, model_path)
    print(f"Saved model → {model_path}")

def main():
    for lang, filename in LANG_FILES.items():
        train_for_lang(lang, filename)

if __name__ == "__main__":
    main()
