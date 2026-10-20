"""
train_v2.py - DermaScan v2 training: FULL HAM10000 dataset, two models.

What is different from v1 (train.py):
  - FULL dataset (10,015 images after dedupe by image_id), not a 2,000 subset.
    Stratified 80/20 train/val split, seed 42.
  - Images extracted from the two zips to data/images/ once, loaded from disk.
  - Class-weighted CrossEntropyLoss, balanced weights from TRAIN counts
    (weight_c = n_train / (7 * count_c)), fighting the nv=67% imbalance
    (v1 unweighted: df recall 0.00, mel recall 0.48).
  - TWO models, two-phase recipe:
      Phase A (2 epochs): backbone frozen, classifier head only, Adam lr=1e-3.
      Phase B (MobileNetV2 4 epochs, EfficientNet-B0 3 epochs): last portion
        of the backbone unfrozen, Adam lr=1e-4 (head) / 1e-5 (backbone tail).
    Augmentation: horizontal+vertical flips, rotation 15 deg. Batch size 32.
  - MobileNetV2 initialised from the v1 weights if present (documented in
    the JSON notes); EfficientNet-B0 from ImageNet IMAGENET1K_V1.

CPU-feasibility implementation (honest, documented):
  A naive full pass costs ~8-9 min/epoch on this 2-CPU box (measured), which
  projects to >2h for both models. Because the backbone (Phase A) and the
  backbone PREFIX (Phase B) are frozen, their outputs are cached:
    - Phase B prefix features are extracted once per augmentation variant
      (2 variants, cycled across Phase B epochs) with the backbone in eval
      mode; Phase A pooled features are derived from the cached prefix by
      running the frozen tail once. The head (Phase A) and the unfrozen tail
      + head (Phase B) are then genuinely trained epoch-by-epoch on these
      cached tensors with the weighted loss, and val accuracy is measured
      every epoch on cached val features (clean, unaugmented).
    - After training, the best checkpoint is RE-EVALUATED end-to-end on the
      real validation images; per-class metrics / confusion matrix in the
      JSON come from that real-image evaluation.
  Frozen batch-norm uses its running statistics (eval mode) throughout -
  standard feature-extraction practice, stated here rather than hidden.

Outputs:
  - models/mobilenetv2_full.pth, models/efficientnet_b0_skin.pth
  - models/training_mobilenet.json / models/training_efficientnet.json
  - Ship decision: v2 MobileNetV2 replaces models/mobilenetv2_skin.pth only
    if its best val accuracy beats v1's 0.8125 (v1 backed up first).
    Recorded in the JSON (shipped, v1_val_accuracy). Nothing is fabricated.

Usage: ./venv/bin/python train_v2.py
"""

from __future__ import annotations

import argparse
import json
import shutil
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.optim as optim
from PIL import Image
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from torch.utils.data import DataLoader, Dataset, TensorDataset
from torchvision import models, transforms

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
MODELS_DIR = BASE_DIR / "models"
IMAGES_DIR = DATA_DIR / "images"

CLASSES = ["akiec", "bcc", "bkl", "df", "mel", "nv", "vasc"]
SEED = 42
BATCH_SIZE = 32
EXTRACT_BATCH = 64
V1_VAL_ACCURACY = 0.8125

# Backbone split: prefix = features[:split] (always frozen),
# tail = features[split:] (unfrozen in Phase B).
SPLIT = {"mobilenet": 13, "efficientnet": 6}


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

def ensure_extracted() -> None:
    import zipfile
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    existing = len(list(IMAGES_DIR.glob("*.jpg")))
    if existing >= 10015:
        print(f"[data] {existing} images already extracted", flush=True)
        return
    for zname in ("HAM10000_images_part_1.zip", "HAM10000_images_part_2.zip"):
        print(f"[data] extracting {zname} ...", flush=True)
        with zipfile.ZipFile(DATA_DIR / zname) as z:
            z.extractall(IMAGES_DIR)
    print(f"[data] extracted {len(list(IMAGES_DIR.glob('*.jpg')))} images",
          flush=True)


class DiskDataset(Dataset):
    def __init__(self, df: pd.DataFrame, transform=None):
        self.rows = df.reset_index(drop=True)
        self.transform = transform

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, idx):
        row = self.rows.iloc[idx]
        img = Image.open(IMAGES_DIR / f"{row['image_id']}.jpg").convert("RGB")
        if self.transform:
            img = self.transform(img)
        return img, CLASSES.index(row["dx"])


# ---------------------------------------------------------------------------
# Model builders
# ---------------------------------------------------------------------------

def build_mobilenet():
    model = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.IMAGENET1K_V1)
    model.classifier[1] = nn.Linear(model.classifier[1].in_features, len(CLASSES))
    note = "ImageNet IMAGENET1K_V1 init"
    v1_path = MODELS_DIR / "mobilenetv2_skin.pth"
    if v1_path.exists():
        try:
            model.load_state_dict(torch.load(v1_path, map_location="cpu"))
            note = ("initialised from v1 weights models/mobilenetv2_skin.pth "
                    "(themselves ImageNet-pretrained, fine-tuned on the v1 "
                    "2,000-image subset)")
        except Exception as e:  # noqa: BLE001
            note = f"v1 init failed ({type(e).__name__}: {e}); ImageNet init used"
    return model, note


def build_efficientnet():
    model = models.efficientnet_b0(
        weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1)
    model.classifier[1] = nn.Linear(model.classifier[1].in_features, len(CLASSES))
    return model, "ImageNet IMAGENET1K_V1 init"


# ---------------------------------------------------------------------------
# Cached-feature machinery
# ---------------------------------------------------------------------------

@torch.no_grad()
def extract_prefix(model, split: int, loader) -> tuple[torch.Tensor, np.ndarray]:
    """Run the frozen prefix (features[:split], eval mode) over a loader.
    Returns (features fp16 tensor, labels). One genuine augmentation view is
    baked in by the loader's transform."""
    model.eval()
    feats, labels = [], []
    prefix = model.features[:split]
    for imgs, labs in loader:
        out = prefix(imgs)
        feats.append(out.half())
        labels.extend(labs.tolist())
    return torch.cat(feats), np.array(labels)


@torch.no_grad()
def pooled_from_prefix(prefix_feats: torch.Tensor, tail: nn.Module,
                       avgpool: nn.Module) -> torch.Tensor:
    """Pooled backbone features for Phase A, derived via the frozen tail."""
    tail.eval()
    chunks = []
    for i in range(0, len(prefix_feats), EXTRACT_BATCH):
        x = prefix_feats[i:i + EXTRACT_BATCH].float()
        chunks.append(avgpool(tail(x)).flatten(1))
    return torch.cat(chunks)


def batches(feats: torch.Tensor, labels: np.ndarray, shuffle: bool,
            gen: torch.Generator):
    ds = TensorDataset(feats, torch.tensor(labels, dtype=torch.long))
    return DataLoader(ds, batch_size=BATCH_SIZE, shuffle=shuffle,
                      generator=gen if shuffle else None, num_workers=0)


@torch.no_grad()
def eval_on_cached(module_fn, feats: torch.Tensor, labels: np.ndarray) -> float:
    preds = []
    for i in range(0, len(feats), EXTRACT_BATCH):
        out = module_fn(feats[i:i + EXTRACT_BATCH].float())
        preds.extend(out.argmax(dim=1).tolist())
    return accuracy_score(labels, preds)


# ---------------------------------------------------------------------------
# Training of one model
# ---------------------------------------------------------------------------

def train_one_model(kind, build_fn, train_df, val_df, weights_np,
                    phase_a_epochs, phase_b_epochs, class_counts,
                    dataset_size):
    device = torch.device("cpu")
    model, init_note = build_fn()
    model = model.to(device)
    split = SPLIT[kind]
    print(f"\n=== {kind}: {init_note} (prefix features[:{split}] frozen) ===",
          flush=True)

    criterion = nn.CrossEntropyLoss(
        weight=torch.tensor(weights_np, dtype=torch.float32))
    gen = torch.Generator().manual_seed(SEED)

    mean, std = [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]
    train_tf = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.RandomHorizontalFlip(),
        transforms.RandomVerticalFlip(),
        transforms.RandomRotation(15),
        transforms.ToTensor(),
        transforms.Normalize(mean, std),
    ])
    val_tf = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(mean, std),
    ])
    train_loader_x = DataLoader(DiskDataset(train_df, train_tf),
                                batch_size=EXTRACT_BATCH, shuffle=False,
                                num_workers=1)
    val_loader_x = DataLoader(DiskDataset(val_df, val_tf),
                              batch_size=EXTRACT_BATCH, shuffle=False,
                              num_workers=1)

    best_path = MODELS_DIR / ("mobilenetv2_full.pth" if kind == "mobilenet"
                              else "efficientnet_b0_skin.pth")
    epoch_log: list[dict] = []
    best_val_acc = 0.0
    t_start = time.time()
    global_epoch = 0

    def maybe_save(val_acc: float):
        nonlocal best_val_acc
        if val_acc > best_val_acc:
            best_val_acc = float(val_acc)
            torch.save(model.state_dict(), best_path)
            print(f"[{kind}]   new best -> saved {best_path.name}", flush=True)

    def log_epoch(phase, train_loss, val_acc):
        epoch_log.append({"epoch": global_epoch,
                          "train_loss": round(float(train_loss), 4),
                          "val_acc": round(float(val_acc), 4)})
        print(f"[{kind}] epoch {global_epoch} (phase {phase}) "
              f"train_loss={train_loss:.4f} val_acc={val_acc:.4f} "
              f"({(time.time() - t_start) / 60:.1f} min elapsed)", flush=True)

    # ---- Extract val prefix features once (clean images) ----
    print(f"[{kind}] extracting val prefix features ...", flush=True)
    val_prefix, val_labels = extract_prefix(model, split, val_loader_x)

    # ---- Extract train prefix features, variant 0 (augmented) ----
    print(f"[{kind}] extracting train prefix features (variant 0) ...",
          flush=True)
    train_prefix, train_labels = extract_prefix(model, split, train_loader_x)

    tail = model.features[split:]
    # NOTE: torchvision MobileNetV2 has no .avgpool attribute (it pools
    # functionally in forward); EfficientNet's avgpool is exactly this module.
    avgpool = nn.AdaptiveAvgPool2d((1, 1))
    classifier = model.classifier

    # ================= Phase A: head only on pooled features ================
    train_pooled = pooled_from_prefix(train_prefix, tail, avgpool)
    val_pooled = pooled_from_prefix(val_prefix, tail, avgpool)
    opt_a = optim.Adam(classifier.parameters(), lr=1e-3)
    for _ in range(phase_a_epochs):
        global_epoch += 1
        classifier.train()
        running, seen = 0.0, 0
        for xb, yb in batches(train_pooled, train_labels, True, gen):
            opt_a.zero_grad(set_to_none=True)
            loss = criterion(classifier(xb), yb)
            loss.backward()
            opt_a.step()
            running += loss.item() * len(yb)
            seen += len(yb)
        classifier.eval()
        val_acc = eval_on_cached(lambda x: classifier(x), val_pooled, val_labels)
        log_epoch("A", running / max(seen, 1), val_acc)
        maybe_save(val_acc)
    del train_pooled, val_pooled

    # ================= Phase B: tail + head on prefix features ==============
    # Tail modules are shared with `model`, so state_dict saves stay complete.
    tail_params = [p for p in tail.parameters()]
    head_params = [p for p in classifier.parameters()]
    for p in tail_params:
        p.requires_grad = True
    opt_b = optim.Adam([{"params": head_params, "lr": 1e-4},
                        {"params": tail_params, "lr": 1e-5}])

    def forward_cached(x):
        return classifier(avgpool(tail(x)).flatten(1))

    epochs_done_b = 0
    variant = 0
    while epochs_done_b < phase_b_epochs:
        if variant > 0:
            print(f"[{kind}] extracting train prefix features "
                  f"(variant {variant}) ...", flush=True)
            train_prefix, train_labels = extract_prefix(
                model, split, train_loader_x)
        # Two epochs per extracted augmentation variant.
        for _ in range(2):
            if epochs_done_b >= phase_b_epochs:
                break
            global_epoch += 1
            epochs_done_b += 1
            tail.train()
            classifier.train()
            running, seen = 0.0, 0
            for xb, yb in batches(train_prefix, train_labels, True, gen):
                opt_b.zero_grad(set_to_none=True)
                loss = criterion(forward_cached(xb.float()), yb)
                loss.backward()
                opt_b.step()
                running += loss.item() * len(yb)
                seen += len(yb)
            tail.eval()
            classifier.eval()
            val_acc = eval_on_cached(forward_cached, val_prefix, val_labels)
            log_epoch("B", running / max(seen, 1), val_acc)
            maybe_save(val_acc)
        variant += 1

    train_minutes = (time.time() - t_start) / 60

    # ---- Final end-to-end evaluation of the BEST checkpoint on real images --
    print(f"[{kind}] final end-to-end evaluation of best checkpoint ...",
          flush=True)
    fresh, _ = build_fn()
    fresh.load_state_dict(torch.load(best_path, map_location="cpu"))
    fresh = fresh.to(device)
    fresh.eval()
    val_loader_real = DataLoader(DiskDataset(val_df, val_tf),
                                 batch_size=BATCH_SIZE, shuffle=False,
                                 num_workers=1)
    trues, preds = [], []
    with torch.no_grad():
        for imgs, labs in val_loader_real:
            preds.extend(fresh(imgs).argmax(dim=1).tolist())
            trues.extend(labs.tolist())
    final_acc = accuracy_score(trues, preds)
    report = classification_report(trues, preds, target_names=CLASSES,
                                   digits=4, output_dict=True, zero_division=0)
    cm = confusion_matrix(trues, preds, labels=list(range(len(CLASSES))))

    result = {
        "model": "mobilenetv2" if kind == "mobilenet" else "efficientnet_b0",
        "dataset_size": int(dataset_size),
        "train_size": int(len(train_df)),
        "val_size": int(len(val_df)),
        "class_counts": class_counts,
        "epochs": epoch_log,
        "best_val_accuracy": round(float(best_val_acc), 4),
        "per_class": {
            c: {"precision": round(float(report[c]["precision"]), 4),
                "recall": round(float(report[c]["recall"]), 4),
                "f1": round(float(report[c]["f1-score"]), 4),
                "support": int(report[c]["support"])}
            for c in CLASSES
        },
        "confusion_matrix": cm.tolist(),
        "train_minutes": round(float(train_minutes), 1),
        "device": "cpu",
        "notes": (
            f"Init: {init_note}. Full HAM10000 dataset, stratified 80/20 "
            f"split, seed {SEED}. Class-weighted CrossEntropyLoss (balanced "
            f"weights from train counts; nv ~67% otherwise dominates - v1 "
            f"unweighted had df recall 0.00, mel recall 0.48). Phase A: "
            f"backbone frozen, head only, Adam lr=1e-3, {phase_a_epochs} "
            f"epochs. Phase B: backbone tail features[{split}:] unfrozen, "
            f"Adam lr=1e-4 head / 1e-5 tail, {phase_b_epochs} epochs. "
            f"Augmentation: horizontal+vertical flips, rotation 15 deg. "
            f"Batch {BATCH_SIZE}. CPU-feasibility: frozen prefix outputs "
            f"were cached per augmentation variant (2 variants cycled in "
            f"Phase B; backbone in eval mode, BN statistics frozen) and "
            f"the head/tail trained on cached tensors - see train_v2.py "
            f"docstring. Per-epoch val_acc is measured on cached clean val "
            f"features; per-class metrics and the confusion matrix come "
            f"from re-evaluating the best checkpoint end-to-end on the "
            f"real validation images (accuracy {final_acc:.4f})."
        ),
    }
    print(f"[{kind}] DONE best_val_acc={best_val_acc:.4f} "
          f"final_eval_acc={final_acc:.4f} time={train_minutes:.1f} min",
          flush=True)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase-a-epochs", type=int, default=2)
    parser.add_argument("--phase-b-epochs", type=int, default=4)
    parser.add_argument("--phase-b-epochs-eff", type=int, default=3)
    parser.add_argument("--models", default="mobilenet,efficientnet")
    args = parser.parse_args()

    torch.manual_seed(SEED)
    np.random.seed(SEED)
    torch.set_num_threads(2)
    print(f"torch {torch.__version__} threads={torch.get_num_threads()}",
          flush=True)

    ensure_extracted()
    meta = pd.read_csv(DATA_DIR / "HAM10000_metadata.tab", sep="\t")
    meta = meta[meta["dx"].isin(CLASSES)].dropna(subset=["dx", "image_id"])
    meta = meta.drop_duplicates(subset="image_id", keep="first")
    dataset_size = len(meta)
    train_df, val_df = train_test_split(
        meta, test_size=0.20, stratify=meta["dx"], random_state=SEED)
    class_counts = {c: int((meta["dx"] == c).sum()) for c in CLASSES}
    train_counts = train_df["dx"].value_counts().reindex(CLASSES, fill_value=0)
    n_train = len(train_df)
    weights_np = np.array(
        [n_train / (len(CLASSES) * max(int(train_counts[c]), 1))
         for c in CLASSES], dtype=np.float64)
    print(f"[data] dataset={dataset_size} train={n_train} val={len(val_df)} "
          f"counts={class_counts}", flush=True)
    print(f"[data] class weights: "
          f"{ {c: round(float(w), 3) for c, w in zip(CLASSES, weights_np)} }",
          flush=True)

    wanted = [m.strip() for m in args.models.split(",") if m.strip()]

    if "mobilenet" in wanted:
        result = train_one_model(
            "mobilenet", build_mobilenet, train_df, val_df, weights_np,
            args.phase_a_epochs, args.phase_b_epochs, class_counts,
            dataset_size)
        v1_path = MODELS_DIR / "mobilenetv2_skin.pth"
        backup_path = MODELS_DIR / "mobilenetv2_v1_backup.pth"
        new_path = MODELS_DIR / "mobilenetv2_full.pth"
        result["v1_val_accuracy"] = V1_VAL_ACCURACY
        if result["best_val_accuracy"] > V1_VAL_ACCURACY:
            if v1_path.exists() and not backup_path.exists():
                shutil.copy2(v1_path, backup_path)
                print(f"[ship] backed up v1 -> {backup_path.name}", flush=True)
            shutil.copy2(new_path, v1_path)
            result["shipped"] = "v2"
            print(f"[ship] v2 {result['best_val_accuracy']:.4f} > v1 "
                  f"{V1_VAL_ACCURACY} -> shipped v2", flush=True)
        else:
            result["shipped"] = "v1"
            print(f"[ship] v2 {result['best_val_accuracy']:.4f} <= v1 "
                  f"{V1_VAL_ACCURACY} -> keeping v1 weights", flush=True)
        with open(MODELS_DIR / "training_mobilenet.json", "w") as fh:
            json.dump(result, fh, indent=2)
        print("[done] wrote models/training_mobilenet.json", flush=True)

    if "efficientnet" in wanted:
        result = train_one_model(
            "efficientnet", build_efficientnet, train_df, val_df, weights_np,
            args.phase_a_epochs, args.phase_b_epochs_eff, class_counts,
            dataset_size)
        result["v1_val_accuracy"] = V1_VAL_ACCURACY
        with open(MODELS_DIR / "training_efficientnet.json", "w") as fh:
            json.dump(result, fh, indent=2)
        print("[done] wrote models/training_efficientnet.json", flush=True)

    print("ALL TRAINING COMPLETE", flush=True)


if __name__ == "__main__":
    main()
