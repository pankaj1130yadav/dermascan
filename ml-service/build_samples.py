"""
build_samples.py - Build the DermaScan sample gallery artifacts.

Picks 8 images deterministically from the full HAM10000 metadata
(sorted by image_id, first unused match per slot) for slots
[mel, mel, nv, nv, bcc, bkl, akiec, df], copies their JPEGs to
static/samples/, runs BOTH shipped models on each (real inference via
app.py's loaders - no fabricated outputs) and writes models/samples.json.

Also generates the hair-removal preprocessing example:
static/samples/hair_before.jpg / hair_after.jpg - the hairiest of the 8
samples (measured by blackhat response) before/after the real
DullRazor-style preprocessing in app.py.

Usage: ./venv/bin/python build_samples.py   (run AFTER train_v2.py)
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

import app as svc  # loads the shipped models exactly as the server does

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
MODELS_DIR = BASE_DIR / "models"
SAMPLES_DIR = BASE_DIR / "static" / "samples"
SLOTS = ["mel", "mel", "nv", "nv", "bcc", "bkl", "akiec", "df"]
CLASSES = ["akiec", "bcc", "bkl", "df", "mel", "nv", "vasc"]


def model_block(model, image: Image.Image):
    if model is None:
        return None
    probs = svc._softmax_probs(model, image)
    predictions, top_class = svc._ranked_predictions(probs)
    return {"predictions": predictions, "top_class": top_class,
            "overall_risk_tier": svc.RISK_TIERS[top_class]}


def hair_score(image: Image.Image) -> float:
    """Fraction of pixels flagged as hair by the blackhat filter."""
    from scipy import ndimage as ndi
    arr = svc._resized_np(image)
    gray = svc._gray(arr)
    y, x = np.ogrid[-4:5, -4:5]
    footprint = (x * x + y * y) <= 16
    blackhat = ndi.grey_closing(gray, footprint=footprint) - gray
    return float((blackhat > 15.0).mean())


def main():
    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    meta = pd.read_csv(DATA_DIR / "HAM10000_metadata.tab", sep="\t")
    meta = meta[meta["dx"].isin(CLASSES)].dropna(subset=["dx", "image_id"])
    meta = meta.drop_duplicates(subset="image_id", keep="first")
    meta = meta.sort_values("image_id").reset_index(drop=True)

    used = set()
    picks = []
    for slot in SLOTS:
        for _, row in meta.iterrows():
            if row["dx"] == slot and row["image_id"] not in used:
                used.add(row["image_id"])
                picks.append(row)
                break
    print(f"picked {len(picks)} samples: {[p['image_id'] for p in picks]}")

    samples = []
    picked_images = {}
    for i, row in enumerate(picks, start=1):
        image_id = row["image_id"]
        src = DATA_DIR / "images" / f"{image_id}.jpg"
        fname = f"{image_id}.jpg"
        shutil.copy2(src, SAMPLES_DIR / fname)
        image = Image.open(src).convert("RGB")
        picked_images[image_id] = image
        entry = {
            "id": i,
            "file": f"samples/{fname}",
            "true_class": row["dx"],
            "true_name": svc.HUMAN_NAMES[row["dx"]],
            "mobilenet": model_block(svc._mobilenet, image),
            "efficientnet": model_block(svc._efficientnet, image),
            "attribution": "HAM10000 (ISIC Archive), CC BY-NC 4.0",
        }
        samples.append(entry)
        print(f"  {i}. {image_id} true={row['dx']} "
              f"mob={entry['mobilenet']['top_class'] if entry['mobilenet'] else None} "
              f"eff={entry['efficientnet']['top_class'] if entry['efficientnet'] else None}")

    with open(MODELS_DIR / "samples.json", "w") as fh:
        json.dump(samples, fh, indent=2)
    print(f"wrote {MODELS_DIR / 'samples.json'}")

    # ---- Hair-removal example: hairiest of the 8 samples ----
    scored = sorted(picks, key=lambda r: hair_score(picked_images[r["image_id"]]),
                    reverse=True)
    hairiest = scored[0]
    score = hair_score(picked_images[hairiest["image_id"]])
    before = picked_images[hairiest["image_id"]].resize((224, 224))
    after = svc.hair_removal(picked_images[hairiest["image_id"]])
    before.save(SAMPLES_DIR / "hair_before.jpg", format="JPEG", quality=90)
    after.save(SAMPLES_DIR / "hair_after.jpg", format="JPEG", quality=90)
    print(f"hair example: {hairiest['image_id']} (hair pixel fraction "
          f"{score:.4f}) -> static/samples/hair_before.jpg / hair_after.jpg")


if __name__ == "__main__":
    main()
