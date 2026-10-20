"""
test_smoke.py - Smoke tests against a RUNNING DermaScan ml-service.

Usage:
    ./venv/bin/python test_smoke.py [base_url]
    ML_SERVICE_URL=http://localhost:8000 ./venv/bin/python test_smoke.py

Default base URL: http://localhost:8000. Plain python + requests, no pytest.
Prints PASS/FAIL per check and a summary; exit code = 1 if any check fails.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import requests

BASE = (sys.argv[1] if len(sys.argv) > 1
        else os.environ.get("ML_SERVICE_URL", "http://localhost:8000")).rstrip("/")
CLASSES = ["akiec", "bcc", "bkl", "df", "mel", "nv", "vasc"]
HERE = Path(__file__).resolve().parent

FAILURES = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global FAILURES
    print(f"{'PASS' if ok else 'FAIL'}: {name}" + (f" ({detail})" if detail else ""))
    if not ok:
        FAILURES += 1


def get_sample_images() -> list[Path]:
    """Two local sample JPEGs (from the built gallery) for upload tests."""
    candidates = sorted((HERE / "static" / "samples").glob("ISIC_*.jpg"))
    if len(candidates) < 2:
        candidates = sorted((HERE / "data" / "images").glob("*.jpg"))[:2]
    return candidates[:2]


def post_image(path_url: str, img: Path, extra_files=None, data=None):
    files = {"file": (img.name, open(img, "rb"), "image/jpeg")}
    if extra_files:
        files.update(extra_files)
    return requests.post(f"{BASE}{path_url}", files=files, data=data or {},
                         timeout=300)


def main() -> int:
    # --- /health ---
    health = {}
    try:
        r = requests.get(f"{BASE}/health", timeout=30)
        health = r.json() if r.ok else {}
        check("GET /health 200 with model flags",
              r.status_code == 200 and "model_loaded" in health
              and "efficientnet_loaded" in health,
              f"status={r.status_code} body={health}")
    except Exception as e:  # noqa: BLE001
        check("GET /health reachable", False, f"{type(e).__name__}: {e}")
        print(f"SUMMARY: service unreachable at {BASE}")
        return 1

    imgs = get_sample_images()
    check("sample images available for upload tests", len(imgs) >= 2,
          f"found={len(imgs)}")
    if len(imgs) < 2:
        print(f"SUMMARY: {FAILURES} failure(s)")
        return 1
    img_a, img_b = imgs

    # --- /predict (MobileNetV2, core + v2 fields) ---
    try:
        r = post_image("/predict", img_a)
        body = r.json() if r.headers.get("content-type", "").startswith(
            "application/json") else {}
        preds = body.get("predictions") or []
        check("POST /predict 200 with predictions over the 7 classes",
              r.status_code == 200 and len(preds) >= 1
              and all(p.get("class_id") in CLASSES for p in preds)
              and body.get("top_class") in CLASSES,
              f"status={r.status_code} top={body.get('top_class')}")
        check("/predict has gradcam field",
              "gradcam" in body and (body["gradcam"] is None
                                     or str(body["gradcam"]).startswith("data:image/jpeg")))
        u = body.get("uncertainty") or {}
        check("/predict has uncertainty {entropy, reliability}",
              isinstance(u.get("entropy"), (int, float))
              and u.get("reliability") in ("high", "moderate", "low"),
              f"uncertainty={u}")
        s = body.get("segmentation") or {}
        check("/predict has segmentation {overlay, coverage_percent}",
              "overlay" in s and isinstance(s.get("coverage_percent"), (int, float)),
              f"segmentation keys={list(s)}")
        check("/predict has quality/lesion/ood",
              "quality" in body and "lesion" in body and "ood" in body)
        check("/predict advisory intact",
              body.get("advisory") == ("Educational demo — not a medical "
                                       "diagnosis. Consult a dermatologist."))
    except Exception as e:  # noqa: BLE001
        check("POST /predict", False, f"{type(e).__name__}: {e}")

    # --- /predict/efficientnet: 200 or honest 503 ---
    try:
        r = post_image("/predict/efficientnet", img_a)
        if r.status_code == 503:
            check("POST /predict/efficientnet honest 503 (model not loaded)",
                  not health.get("efficientnet_loaded", False),
                  "503 returned")
        else:
            body = r.json()
            check("POST /predict/efficientnet 200 with valid top_class",
                  r.status_code == 200 and body.get("top_class") in CLASSES,
                  f"status={r.status_code} top={body.get('top_class')}")
    except Exception as e:  # noqa: BLE001
        check("POST /predict/efficientnet", False, f"{type(e).__name__}: {e}")

    # --- /predict/ensemble consistency ---
    try:
        r = post_image("/predict/ensemble", img_a)
        if r.status_code == 503:
            check("POST /predict/ensemble honest 503 (a model is missing)",
                  not (health.get("model_loaded") and health.get("efficientnet_loaded")),
                  "503 returned")
        else:
            body = r.json()
            check("POST /predict/ensemble 200, top_class in classes, "
                  "disagreement is bool",
                  r.status_code == 200 and body.get("top_class") in CLASSES
                  and isinstance(body.get("disagreement"), bool)
                  and "per_model" in body,
                  f"status={r.status_code} top={body.get('top_class')}")
    except Exception as e:  # noqa: BLE001
        check("POST /predict/ensemble", False, f"{type(e).__name__}: {e}")

    # --- /model-info ---
    try:
        r = requests.get(f"{BASE}/model-info", timeout=60)
        body = r.json() if r.ok else {}
        check("GET /model-info has both models + dataset_distribution",
              r.status_code == 200 and body.get("mobilenet") is not None
              and body.get("efficientnet") is not None
              and isinstance(body.get("dataset_distribution"), dict)
              and sum((body.get("dataset_distribution") or {}).values()) > 9000,
              f"status={r.status_code} dist={body.get('dataset_distribution')}")
    except Exception as e:  # noqa: BLE001
        check("GET /model-info", False, f"{type(e).__name__}: {e}")

    # --- /samples: 8 items ---
    try:
        r = requests.get(f"{BASE}/samples", timeout=30)
        body = r.json() if r.ok else None
        check("GET /samples returns 8 items",
              r.status_code == 200 and isinstance(body, list) and len(body) == 8,
              f"status={r.status_code} n={len(body) if isinstance(body, list) else 'n/a'}")
    except Exception as e:  # noqa: BLE001
        check("GET /samples", False, f"{type(e).__name__}: {e}")

    # --- /change-score numeric fields ---
    try:
        files = {"file_a": (img_a.name, open(img_a, "rb"), "image/jpeg"),
                 "file_b": (img_b.name, open(img_b, "rb"), "image/jpeg")}
        r = requests.post(f"{BASE}/change-score", files=files, timeout=120)
        body = r.json() if r.ok else {}
        numeric = all(isinstance(body.get(k), (int, float)) for k in
                      ("area_a_percent", "area_b_percent", "area_delta_percent",
                       "color_delta", "change_score"))
        check("POST /change-score returns numeric fields",
              r.status_code == 200 and numeric, f"status={r.status_code} body={body}")
    except Exception as e:  # noqa: BLE001
        check("POST /change-score", False, f"{type(e).__name__}: {e}")

    print(f"SUMMARY: {'ALL PASS' if FAILURES == 0 else str(FAILURES) + ' failure(s)'} "
          f"against {BASE}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
