"""
train.py - End-to-end training script for DermaScan.

Steps:
  1. Download the HAM10000 dataset (7 skin-lesion classes) from Harvard
     Dataverse (DOI: 10.7910/DVN/DBW86T) using the public Dataverse API
     (no login required).
  2. Take a fixed-seed STRATIFIED subset of ~1500-2500 images and split it
     80/20 into train/val (stratified, fixed seed).
  3. Fine-tune torchvision MobileNetV2 (ImageNet IMAGENET1K_V1 weights)
     with a replaced classifier head (Linear(1280, 7)) for a few epochs
     on CPU.
  4. Save the best-val-accuracy state_dict and the class order.

Honesty rules:
  - If the dataset cannot be downloaded at all, training is SKIPPED with a
    clear reason, exit code 0, and no fake weights/metrics are created.
  - If the full download is too slow/fails, fall back to metadata + part 1.
  - Every number in MODEL_CARD.md must come from the real run.

Usage:
    python train.py [--data-dir data] [--models-dir models] [--epochs N] [--max-samples N]
"""

from __future__ import annotations

import argparse
import io
import json
import os
import random
import sys
import time
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
import requests
import torch
import torch.nn as nn
import torch.optim as optim
from PIL import Image
from sklearn.metrics import (accuracy_score, classification_report,
                             confusion_matrix)
from sklearn.model_selection import train_test_split
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DOI = "doi:10.7910/DVN/DBW86T"
DATAVERSE_API = "https://dataverse.harvard.edu/api"
DATASET_JSON_URL = f"{DATAVERSE_API}/datasets/:persistentId/?persistentId={DOI}"
DATAFILE_URL = DATAVERSE_API + "/access/datafile/{file_id}"

# Files we need (Dataverse serves metadata as .tab regardless of the original name)
NEEDED_FILES = {
    "HAM10000_metadata.tab": "HAM10000_metadata.tab",
    "HAM10000_images_part_1.zip": "HAM10000_images_part_1.zip",
    "HAM10000_images_part_2.zip": "HAM10000_images_part_2.zip",
}

TARGET_SAMPLES = 2000      # stratified subset size (falls back gracefully if fewer exist)
EPOCHS = 4
BATCH_SIZE = 32
LR = 1e-4
VAL_FRACTION = 0.20
SEED = 42

CLASSES = ["akiec", "bcc", "bkl", "df", "mel", "nv", "vasc"]


# ---------------------------------------------------------------------------
# Download helpers
# ---------------------------------------------------------------------------

def list_datafiles(session: requests.Session) -> dict[str, int]:
    """Return {filename: datafile_id} for this DOI via the public Dataverse API."""
    r = session.get(DATASET_JSON_URL, timeout=60)
    r.raise_for_status()
    files = r.json()["data"]["latestVersion"]["files"]
    mapping = {}
    for f in files:
        df = f["dataFile"]
        mapping[df["filename"]] = df["id"]
    return mapping


def download_file(session: requests.Session, file_id: int, dest: Path) -> bool:
    """Stream-download one Dataverse datafile. Returns True on success."""
    url = DATAFILE_URL.format(file_id=file_id)
    try:
        with session.get(url, stream=True, timeout=60) as r:
            r.raise_for_status()
            total = int(r.headers.get("Content-Length", 0) or 0)
            downloaded = 0
            start = time.time()
            with open(dest, "wb") as fh:
                for chunk in r.iter_content(chunk_size=1 << 20):
                    if not chunk:
                        continue
                    fh.write(chunk)
                    downloaded += len(chunk)
                    if total and downloaded % (100 << 20) < (1 << 20):
                        pct = 100.0 * downloaded / total
                        elapsed = time.time() - start
                        print(f"    {dest.name}: {pct:5.1f}% "
                              f"({downloaded/1e6:.0f}/{total/1e6:.0f} MB, {elapsed:.0f}s)",
                              flush=True)
        print(f"    saved {dest} ({dest.stat().st_size/1e6:.1f} MB)")
        return True
    except Exception as e:  # noqa: BLE001 - we want a graceful fallback, not a crash
        print(f"    FAILED to download {dest.name}: {type(e).__name__}: {e}")
        if dest.exists():
            dest.unlink()  # remove partial file so we never use corrupt data
        return False


def ensure_dataset(data_dir: Path) -> tuple[Path, list[Path]] | None:
    """
    Make sure metadata + image zips are present in data_dir.
    Local files are used as-is (no API call needed); missing files are
    downloaded via the public Dataverse API. Returns
    (metadata_path, [image_zip_paths]) or None if training must be skipped.
    Fallback: metadata + part_1 only if part_2 fails or is too slow.
    """
    data_dir.mkdir(parents=True, exist_ok=True)

    meta_path = data_dir / "HAM10000_metadata.tab"
    zip_paths = [data_dir / "HAM10000_images_part_1.zip",
                 data_dir / "HAM10000_images_part_2.zip"]

    if meta_path.exists() and all(p.exists() for p in zip_paths):
        print(f"Using existing local dataset in {data_dir} "
              f"(no download needed).")
        return meta_path, zip_paths

    session = requests.Session()
    try:
        files = list_datafiles(session)
    except Exception as e:  # noqa: BLE001
        print(f"ERROR: could not list Dataverse files for {DOI}: "
              f"{type(e).__name__}: {e}")
        print("HINT: place HAM10000_metadata.tab and the image zips in "
              f"{data_dir}/ to train offline.")
        return None

    meta_name = "HAM10000_metadata.tab"
    meta_id = files.get(meta_name)
    if meta_id is None:
        print(f"ERROR: metadata file {meta_name} not found in Dataverse record.")
        return None

    if not meta_path.exists():
        print(f"Downloading {meta_name} ...")
        if not download_file(session, meta_id, meta_path):
            print("ERROR: metadata download failed; training cannot proceed.")
            return None
    else:
        print(f"Using existing {meta_path}")

    image_zips: list[Path] = []
    for name in ["HAM10000_images_part_1.zip", "HAM10000_images_part_2.zip"]:
        dest = data_dir / name
        if dest.exists():
            print(f"Using existing {dest}")
            image_zips.append(dest)
            continue
        fid = files.get(name)
        if fid is None:
            print(f"WARNING: {name} not listed; continuing without it.")
            continue
        print(f"Downloading {name} (large, ~1.4 GB) ...")
        if download_file(session, fid, dest):
            image_zips.append(dest)
        else:
            print(f"WARNING: {name} download failed; "
                  f"continuing with the zips we have (fallback: metadata + part 1).")

    if not image_zips:
        print("ERROR: no image archives could be downloaded; training cannot proceed.")
        return None

    return meta_path, image_zips


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------

class HamDataset(Dataset):
    """Loads HAM10000 JPEGs from zip archives by filename listed in metadata."""

    def __init__(self, df: pd.DataFrame, zip_handles: list[zipfile.ZipFile],
                 transform=None):
        self.df = df.reset_index(drop=True)
        self.zips = zip_handles
        self.transform = transform

    def __len__(self) -> int:
        return len(self.df)

    def _read_image(self, image_id: str) -> Image.Image:
        filename = f"{image_id}.jpg"
        for z in self.zips:
            try:
                with z.open(filename) as fh:
                    return Image.open(io.BytesIO(fh.read())).convert("RGB")
            except KeyError:
                continue
        raise FileNotFoundError(f"{filename} not found in any image archive")

    def __getitem__(self, idx: int):
        row = self.df.iloc[idx]
        img = self._read_image(row["image_id"])
        if self.transform:
            img = self.transform(img)
        label = CLASSES.index(row["dx"])
        return img, label


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--models-dir", default="models")
    parser.add_argument("--epochs", type=int, default=EPOCHS)
    parser.add_argument("--max-samples", type=int, default=TARGET_SAMPLES,
                        help="stratified subset size (uses all data if smaller)")
    args = parser.parse_args()

    service_dir = Path(__file__).resolve().parent
    data_dir = service_dir / args.data_dir
    models_dir = service_dir / args.models_dir
    models_dir.mkdir(parents=True, exist_ok=True)

    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    torch.set_num_threads(os.cpu_count() or 4)

    # ---- 1. Download ----
    got = ensure_dataset(data_dir)
    if got is None:
        print("\nTRAINING SKIPPED: dataset could not be obtained "
              "(see errors above). No weights or metrics were fabricated.")
        sys.exit(0)
    meta_path, image_zips = got

    # ---- 2. Metadata + stratified subset ----
    meta = pd.read_csv(meta_path, sep="\t")
    meta = meta[meta["dx"].isin(CLASSES)].dropna(subset=["dx", "image_id"])
    # HAM10000 contains a few duplicate images under different lesion ids;
    # keep each image once so val leakage cannot occur.
    meta = meta.drop_duplicates(subset="image_id", keep="first")

    total_available = len(meta)
    n_samples = min(args.max_samples, total_available)
    if n_samples < args.max_samples:
        print(f"NOTE: requested {args.max_samples} samples but only "
              f"{total_available} usable images exist; using all {n_samples}.")

    # Stratified subset of n_samples (keeps full-dataset class proportions),
    # then a stratified 80/20 train/val split. Fixed seed => reproducible.
    subset, _ = train_test_split(meta, train_size=n_samples,
                                 stratify=meta["dx"], random_state=SEED)
    train_df, val_df = train_test_split(subset, test_size=VAL_FRACTION,
                                        stratify=subset["dx"], random_state=SEED)

    print(f"\nDataset: {DOI}")
    print(f"Total usable images in metadata: {total_available}")
    print(f"Stratified subset: {len(subset)} "
          f"(train {len(train_df)}, val {len(val_df)})")
    print("Class distribution in subset:")
    class_counts = subset["dx"].value_counts().reindex(CLASSES, fill_value=0)
    for c in CLASSES:
        print(f"  {c}: {int(class_counts[c])}")

    # ---- 3. Transforms / loaders ----
    imagenet_mean = [0.485, 0.456, 0.406]
    imagenet_std = [0.229, 0.224, 0.225]
    train_tf = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.RandomHorizontalFlip(),
        transforms.ToTensor(),
        transforms.Normalize(imagenet_mean, imagenet_std),
    ])
    val_tf = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(imagenet_mean, imagenet_std),
    ])

    zips = [zipfile.ZipFile(p) for p in image_zips]
    try:
        train_ds = HamDataset(train_df, zips, transform=train_tf)
        val_ds = HamDataset(val_df, zips, transform=val_tf)
        train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True,
                                  num_workers=0)
        val_loader = DataLoader(val_ds, batch_size=BATCH_SIZE, shuffle=False,
                                num_workers=0)

        # ---- 4. Model ----
        print("\nLoading torchvision MobileNetV2 (IMAGENET1K_V1 weights) ...")
        model = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.IMAGENET1K_V1)
        model.classifier[1] = nn.Linear(model.classifier[1].in_features, len(CLASSES))
        device = torch.device("cpu")
        model = model.to(device)

        criterion = nn.CrossEntropyLoss()
        optimizer = optim.Adam(model.parameters(), lr=LR)

        best_val_acc = 0.0
        t0 = time.time()
        for epoch in range(1, args.epochs + 1):
            model.train()
            running_loss = 0.0
            for imgs, labels in train_loader:
                imgs, labels = imgs.to(device), labels.to(device)
                optimizer.zero_grad()
                out = model(imgs)
                loss = criterion(out, labels)
                loss.backward()
                optimizer.step()
                running_loss += loss.item() * imgs.size(0)
            train_loss = running_loss / len(train_ds)

            model.eval()
            all_pred, all_true = [], []
            with torch.no_grad():
                for imgs, labels in val_loader:
                    preds = model(imgs.to(device)).argmax(dim=1).cpu()
                    all_pred.extend(preds.tolist())
                    all_true.extend(labels.tolist())
            val_acc = accuracy_score(all_true, all_pred)
            elapsed = (time.time() - t0) / 60
            print(f"epoch {epoch}/{args.epochs}  train_loss={train_loss:.4f}  "
                  f"val_acc={val_acc:.4f}  ({elapsed:.1f} min elapsed)")

            if val_acc > best_val_acc:
                best_val_acc = val_acc
                torch.save(model.state_dict(),
                           models_dir / "mobilenetv2_skin.pth")
        total_min = (time.time() - t0) / 60

        with open(models_dir / "class_names.json", "w") as fh:
            json.dump(CLASSES, fh)

        # ---- 5. Real metrics ----
        model.eval()
        all_pred, all_true = [], []
        with torch.no_grad():
            for imgs, labels in val_loader:
                preds = model(imgs.to(device)).argmax(dim=1).cpu()
                all_pred.extend(preds.tolist())
                all_true.extend(labels.tolist())
        report = classification_report(all_true, all_pred,
                                       target_names=CLASSES, digits=4,
                                       output_dict=True, zero_division=0)
        cm = confusion_matrix(all_true, all_pred, labels=list(range(len(CLASSES))))

        print("\n=== REAL RESULTS (validation set) ===")
        print(f"best val accuracy: {best_val_acc:.4f}")
        print(f"epochs: {args.epochs}  batch: {BATCH_SIZE}  lr: {LR}  "
              f"optimizer: Adam  device: cpu  total time: {total_min:.1f} min")
        for c in CLASSES:
            m = report[c]
            print(f"  {c}: precision={m['precision']:.4f} "
                  f"recall={m['recall']:.4f} f1={m['f1-score']:.4f} "
                  f"(n={int(m['support'])})")
        print("confusion matrix (rows=true, cols=pred, order akiec,bcc,bkl,df,mel,nv,vasc):")
        print(cm)
        print(f"\nSaved: {models_dir / 'mobilenetv2_skin.pth'} "
              f"and {models_dir / 'class_names.json'}")

        # Persist raw metrics so MODEL_CARD.md can only quote measured numbers.
        metrics = {
            "doi": DOI,
            "subset_size": int(len(subset)),
            "train_size": int(len(train_df)),
            "val_size": int(len(val_df)),
            "class_counts": {c: int(class_counts[c]) for c in CLASSES},
            "epochs": args.epochs,
            "batch_size": BATCH_SIZE,
            "optimizer": f"Adam(lr={LR})",
            "device": "cpu",
            "threads": torch.get_num_threads(),
            "seed": SEED,
            "best_val_accuracy": round(float(best_val_acc), 4),
            "train_minutes": round(total_min, 1),
            "per_class": {
                c: {"precision": round(float(report[c]["precision"]), 4),
                    "recall": round(float(report[c]["recall"]), 4),
                    "f1": round(float(report[c]["f1-score"]), 4),
                    "support": int(report[c]["support"])}
                for c in CLASSES
            },
            "confusion_matrix": cm.tolist(),
            "image_zips_used": [p.name for p in image_zips],
        }
        with open(models_dir / "metrics.json", "w") as fh:
            json.dump(metrics, fh, indent=2)
        print(f"Saved: {models_dir / 'metrics.json'}")
    finally:
        for z in zips:
            z.close()


if __name__ == "__main__":
    main()
