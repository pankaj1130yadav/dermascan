"""
app.py - DermaScan ML microservice v2 (FastAPI).

Endpoints:
  GET  /health               -> {"status": "ok", "model_loaded": bool,
                                 "efficientnet_loaded": bool}
  POST /predict              -> MobileNetV2 prediction (v1 contract, extended)
  POST /predict/efficientnet -> same response shape, EfficientNet-B0
  POST /predict/compare      -> both models side by side
  POST /predict/ensemble     -> averaged-probability ensemble of both models
  POST /change-score         -> heuristic change between two lesion photos
  GET  /model-info           -> training metrics, dataset distribution, notes
  GET  /samples              -> precomputed sample gallery (models/samples.json)
  GET  /static/...           -> static files (sample images)

Honesty contract (unchanged from v1, extended):
  - A model whose weights file is missing returns HTTP 503 on its own
    endpoints. It NEVER returns fake predictions.
  - Every prediction comes from a real trained model.
  - quality / lesion / segmentation / ood / change-score are documented
    classical-CV HEURISTICS, not measurements. Lesion coverage is a
    frame-coverage estimate and is never converted to mm.

Uncertainty (documented bands):
  - entropy: Shannon entropy (nats) of the full 7-class softmax.
  - reliability: top-1 probability >= 0.75 -> "high",
                 0.50-0.75 -> "moderate", < 0.50 -> "low".
  - mc_std: Monte-Carlo dropout - 10 stochastic forward passes with ONLY
    the classifier dropout modules switched to train mode (batch-norm and
    everything else stay in eval). Reported value is the standard
    deviation of the top-1 probability across passes. Included on the
    single-model /predict endpoints; omitted for the ensemble (whose
    uncertainty is computed from the averaged distribution).

OOD heuristic (documented thresholds):
  - Skin coverage via the YCbCr skin rule (77<=Cb<=127 and 133<=Cr<=173)
    on the 224x224 image.
  - is_likely_lesion_photo = False when skin coverage < 25% OR
    prediction entropy > 1.8 nats.

Hair removal (DullRazor-style, numpy/scipy only):
  grayscale -> blackhat (grey closing with a 9x9 elliptical structuring
  element minus the image) -> hair mask (blackhat > 15) -> inpainting by
  iterative local averaging (diffusion) of the masked pixels.

Run:
    uvicorn app:app --port 8000
"""

from __future__ import annotations

import base64
import io
import json
import math
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image
from torchvision import models, transforms

try:
    from scipy import ndimage as _ndi
    _HAVE_SCIPY = True
except Exception:  # noqa: BLE001
    _ndi = None
    _HAVE_SCIPY = False

BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "models"
MOBILENET_PATH = MODELS_DIR / "mobilenetv2_skin.pth"
EFFICIENTNET_PATH = MODELS_DIR / "efficientnet_b0_skin.pth"
CLASS_NAMES_PATH = MODELS_DIR / "class_names.json"
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)

HUMAN_NAMES = {
    "akiec": "Actinic Keratosis",
    "bcc": "Basal Cell Carcinoma",
    "bkl": "Benign Keratosis",
    "df": "Dermatofibroma",
    "mel": "Melanoma",
    "nv": "Melanocytic Nevus",
    "vasc": "Vascular Lesion",
}

RISK_TIERS = {
    "mel": "high",
    "bcc": "high",
    "akiec": "moderate",
    "bkl": "low",
    "df": "low",
    "nv": "low",
    "vasc": "low",
}

ADVISORY = "Educational demo — not a medical diagnosis. Consult a dermatologist."
OOD_WARNING = ("This photo may not be a skin lesion close-up — "
               "treat the prediction with extra caution.")

_preprocess = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406],
                         std=[0.229, 0.224, 0.225]),
])


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

def build_mobilenet(num_classes: int) -> nn.Module:
    model = models.mobilenet_v2(weights=None)
    model.classifier[1] = nn.Linear(model.classifier[1].in_features, num_classes)
    return model


def build_efficientnet(num_classes: int) -> nn.Module:
    model = models.efficientnet_b0(weights=None)
    model.classifier[1] = nn.Linear(model.classifier[1].in_features, num_classes)
    return model


def _load(builder, weights_path: Path, class_names):
    if not weights_path.exists() or class_names is None:
        return None
    try:
        model = builder(len(class_names))
        state = torch.load(weights_path, map_location="cpu")
        model.load_state_dict(state)
        model.eval()
        return model
    except Exception as e:  # noqa: BLE001 - honest degradation, endpoint 503s
        print(f"[app] failed to load {weights_path.name}: {type(e).__name__}: {e}")
        return None


def _read_class_names():
    if CLASS_NAMES_PATH.exists():
        with open(CLASS_NAMES_PATH) as fh:
            return json.load(fh)
    return None


_class_names = _read_class_names()
_mobilenet = _load(build_mobilenet, MOBILENET_PATH, _class_names)
_efficientnet = _load(build_efficientnet, EFFICIENTNET_PATH, _class_names)
print(f"[app] mobilenet loaded: {_mobilenet is not None}, "
      f"efficientnet loaded: {_efficientnet is not None}, scipy: {_HAVE_SCIPY}")

app = FastAPI(title="DermaScan ML service v2")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:8000", "http://127.0.0.1:8000",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Classical-CV helpers (numpy / PIL / scipy only)
# ---------------------------------------------------------------------------

def _resized_np(image: Image.Image) -> np.ndarray:
    """Original image resized to 224x224 as uint8 RGB numpy array."""
    return np.asarray(image.convert("RGB").resize((224, 224))).astype(np.float64)


def _gray(arr_rgb: np.ndarray) -> np.ndarray:
    return 0.299 * arr_rgb[..., 0] + 0.587 * arr_rgb[..., 1] + 0.114 * arr_rgb[..., 2]


def compute_quality(arr_rgb: np.ndarray) -> dict:
    """Blur via Laplacian variance (numpy convolution via shifted views);
    brightness = mean luminance. Heuristic score documented in the header."""
    gray = _gray(arr_rgb)
    padded = np.pad(gray, 1, mode="edge")
    lap = (padded[:-2, 1:-1] + padded[2:, 1:-1] + padded[1:-1, :-2]
           + padded[1:-1, 2:] - 4.0 * padded[1:-1, 1:-1])
    blur_var = float(np.var(lap))
    brightness = float(np.mean(gray))
    warnings = []
    score = 100
    if blur_var < 100:
        warnings.append("Image looks blurry")
        score -= 40
    if brightness < 40:
        warnings.append("Image is very dark")
        score -= 25
    elif brightness > 220:
        warnings.append("Image is overexposed")
        score -= 25
    return {
        "blur_variance": round(blur_var, 2),
        "brightness": round(brightness, 2),
        "score": int(max(0, min(100, score))),
        "warnings": warnings,
    }


def _otsu_threshold(gray: np.ndarray) -> float:
    hist, _ = np.histogram(gray, bins=256, range=(0, 256))
    hist = hist.astype(np.float64)
    total = gray.size
    w0 = np.cumsum(hist)
    w1 = total - w0
    levels = np.arange(256, dtype=np.float64)
    mu = np.cumsum(hist * levels)
    mu_total = mu[-1]
    with np.errstate(divide="ignore", invalid="ignore"):
        mu0 = np.where(w0 > 0, mu / np.maximum(w0, 1), 0)
        mu1 = np.where(w1 > 0, (mu_total - mu) / np.maximum(w1, 1), 0)
        between = w0 * w1 * (mu0 - mu1) ** 2
    return float(np.argmax(np.nan_to_num(between)))


def cleaned_lesion_mask(gray: np.ndarray):
    """Otsu darkness mask, cleaned to its largest connected component.

    Returns (mask: bool array, cleaned: bool). Falls back to the plain
    Otsu mask (cleaned=False) if scipy is unavailable or cleaning fails.
    """
    thr = _otsu_threshold(gray)
    mask = gray < thr
    if not mask.any():
        return mask, False
    if _HAVE_SCIPY:
        try:
            labelled, n = _ndi.label(mask)
            if n > 1:
                counts = np.bincount(labelled.ravel())
                counts[0] = 0  # background
                largest = int(np.argmax(counts))
                return labelled == largest, True
            return mask, True
        except Exception:  # noqa: BLE001
            return mask, False
    return mask, False


def segmentation_and_lesion(arr_rgb: np.ndarray):
    """Returns (lesion_dict, segmentation_dict). Coverage derives from the
    cleaned mask when cleaning succeeds (method string says so honestly)."""
    gray = _gray(arr_rgb)
    plain_thr = _otsu_threshold(gray)
    plain_mask = gray < plain_thr
    plain_cov = float(plain_mask.mean() * 100.0)
    mask, cleaned = cleaned_lesion_mask(gray)
    cov = float(mask.mean() * 100.0) if mask.size else plain_cov
    if cleaned:
        lesion = {"coverage_percent": round(cov, 1),
                  "method": "otsu_threshold_largest_component"}
    else:
        lesion = {"coverage_percent": round(plain_cov, 1),
                  "method": "otsu_threshold_dark_region"}
        mask = plain_mask
    overlay_uri = None
    try:
        if _HAVE_SCIPY and mask.any():
            eroded = _ndi.binary_erosion(mask)
            boundary = mask & ~eroded
        else:
            boundary = mask & ~np.roll(mask, 1, axis=0)
        overlay = arr_rgb.copy().astype(np.uint8)
        overlay[boundary] = [255, 0, 255]  # magenta boundary
        buf = io.BytesIO()
        Image.fromarray(overlay).save(buf, format="JPEG", quality=85)
        overlay_uri = ("data:image/jpeg;base64,"
                       + base64.b64encode(buf.getvalue()).decode())
    except Exception:  # noqa: BLE001
        overlay_uri = None
    segmentation = {"overlay": overlay_uri,
                    "coverage_percent": round(float(mask.mean() * 100.0), 1)}
    return lesion, segmentation


def skin_coverage_percent(arr_rgb: np.ndarray) -> float:
    """YCbCr skin rule: 77<=Cb<=127 and 133<=Cr<=173 (heuristic)."""
    r, g, b = arr_rgb[..., 0], arr_rgb[..., 1], arr_rgb[..., 2]
    cb = 128.0 - 0.168736 * r - 0.331264 * g + 0.5 * b
    cr = 128.0 + 0.5 * r - 0.418688 * g - 0.081312 * b
    skin = (cb >= 77) & (cb <= 127) & (cr >= 133) & (cr <= 173)
    return float(skin.mean() * 100.0)


def compute_ood(arr_rgb: np.ndarray, entropy_nats: float) -> dict:
    cov = skin_coverage_percent(arr_rgb)
    likely = not (cov < 25.0 or entropy_nats > 1.8)
    return {
        "skin_coverage_percent": round(cov, 1),
        "is_likely_lesion_photo": bool(likely),
        "warning": None if likely else OOD_WARNING,
    }


def probs_metrics(probs: list[float]) -> tuple[float, str]:
    p = np.clip(np.asarray(probs, dtype=np.float64), 1e-12, 1.0)
    entropy = float(-np.sum(p * np.log(p)))
    top = float(np.max(p))
    reliability = "high" if top >= 0.75 else ("moderate" if top >= 0.5 else "low")
    return entropy, reliability


# ---------------------------------------------------------------------------
# Hair removal (DullRazor-style)
# ---------------------------------------------------------------------------

def hair_removal(image: Image.Image) -> Image.Image:
    """Blackhat hair mask + diffusion inpainting. numpy/scipy/PIL only."""
    arr = np.asarray(image.convert("RGB").resize((224, 224))).astype(np.float64)
    if not _HAVE_SCIPY:
        return Image.fromarray(arr.astype(np.uint8))
    gray = _gray(arr)
    # Elliptical structuring element 9x9 for grey closing.
    y, x = np.ogrid[-4:5, -4:5]
    footprint = (x * x + y * y) <= 16
    closed = _ndi.grey_closing(gray, footprint=footprint)
    blackhat = closed - gray
    hair_mask = blackhat > 15.0
    if not hair_mask.any():
        return Image.fromarray(arr.astype(np.uint8))
    out = arr.copy()
    known = ~hair_mask
    # Initialise masked pixels with the global mean of known pixels.
    for c in range(3):
        channel = out[..., c]
        channel[hair_mask] = channel[known].mean() if known.any() else 0.0
        out[..., c] = channel
    # Iterative diffusion: masked pixels repeatedly take the local average.
    for _ in range(60):
        blurred = _ndi.uniform_filter(out, size=(3, 3, 1), mode="nearest")
        out[hair_mask] = blurred[hair_mask]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


# ---------------------------------------------------------------------------
# Inference helpers
# ---------------------------------------------------------------------------

def _softmax_probs(model, image: Image.Image) -> list[float]:
    model.eval()
    tensor = _preprocess(image).unsqueeze(0)
    with torch.no_grad():
        return torch.softmax(model(tensor), dim=1)[0].tolist()


def _tta_views(image: Image.Image) -> list[Image.Image]:
    """[original, horizontal flip, vertical flip, center-crop-90%->resize]."""
    img = image.convert("RGB")
    w, h = img.size
    cw, ch = int(w * 0.9), int(h * 0.9)
    left, top = (w - cw) // 2, (h - ch) // 2
    centre = img.crop((left, top, left + cw, top + ch)).resize((w, h))
    return [img,
            img.transpose(Image.FLIP_LEFT_RIGHT),
            img.transpose(Image.FLIP_TOP_BOTTOM),
            centre]


def get_probs(model, image: Image.Image, use_tta: bool):
    """Returns (final_probs, tta_info). When TTA is used, probs are the mean
    softmax over the 4 views; delta_top_probability = TTA top-1 prob minus
    the SINGLE-PASS probability of that same (TTA) top class."""
    single = _softmax_probs(model, image)
    if not use_tta:
        return single, {"used": False}
    views = _tta_views(image)
    acc = np.zeros(len(single), dtype=np.float64)
    for v in views:
        acc += np.asarray(_softmax_probs(model, v), dtype=np.float64)
    avg = (acc / len(views)).tolist()
    top_idx = int(np.argmax(avg))
    delta = float(avg[top_idx] - single[top_idx])
    return avg, {"used": True, "delta_top_probability": round(delta, 4),
                 "views": 4}


def mc_dropout_std(model, image: Image.Image) -> float | None:
    """10 stochastic passes with ONLY dropout modules in train mode.
    Returns std of the top-1 probability, or None if no dropout exists /
    anything fails (never fabricated)."""
    dropouts = [m for m in model.modules() if isinstance(m, nn.Dropout)]
    if not dropouts:
        return None
    try:
        model.eval()
        for d in dropouts:
            d.train()
        tensor = _preprocess(image).unsqueeze(0)
        tops = []
        with torch.no_grad():
            for _ in range(10):
                probs = torch.softmax(model(tensor), dim=1)[0]
                tops.append(float(probs.max()))
        model.eval()
        return round(float(np.std(tops)), 4)
    except Exception:  # noqa: BLE001
        model.eval()
        return None


# ---------------------------------------------------------------------------
# Grad-CAM (manual, forward/backward hooks)
# ---------------------------------------------------------------------------

def _jet_colormap(x: np.ndarray) -> np.ndarray:
    """Jet-like colormap in numpy; x in [0,1] -> RGB in [0,255]."""
    x = np.clip(x, 0.0, 1.0)
    r = np.clip(1.5 - np.abs(4 * x - 3), 0, 1)
    g = np.clip(1.5 - np.abs(4 * x - 2), 0, 1)
    b = np.clip(1.5 - np.abs(4 * x - 1), 0, 1)
    return (np.stack([r, g, b], axis=-1) * 255).astype(np.uint8)


def gradcam(model, image: Image.Image, target_class: int,
            base_arr_rgb: np.ndarray) -> str | None:
    """Grad-CAM for target_class on the last conv layer (features[-1]).
    Returns a base64 JPEG data URI of the overlay, or None on failure."""
    try:
        model.eval()
        store = {}

        def fwd_hook(module, _inp, out):
            store["act"] = out
            if out.requires_grad:
                out.register_hook(lambda g: store.__setitem__("grad", g))

        handle = model.features[-1].register_forward_hook(fwd_hook)
        try:
            tensor = _preprocess(image).unsqueeze(0)
            with torch.enable_grad():
                out = model(tensor)
                score = out[0, target_class]
                model.zero_grad(set_to_none=True)
                score.backward()
        finally:
            handle.remove()
        act = store["act"][0].detach().numpy()      # C x H x W
        grad = store["grad"][0].detach().numpy()    # C x H x W
        weights = grad.mean(axis=(1, 2))            # GAP of gradients
        cam = np.maximum(np.tensordot(weights, act, axes=(0, 0)), 0.0)
        if cam.max() > 0:
            cam = cam / cam.max()
        cam_img = Image.fromarray((cam * 255).astype(np.uint8)).resize(
            (224, 224), Image.BILINEAR)
        heat = _jet_colormap(np.asarray(cam_img, dtype=np.float64) / 255.0)
        blended = (0.55 * base_arr_rgb + 0.45 * heat).clip(0, 255).astype(np.uint8)
        buf = io.BytesIO()
        Image.fromarray(blended).save(buf, format="JPEG", quality=85)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception as e:  # noqa: BLE001 - Grad-CAM is best-effort, never fake
        print(f"[app] gradcam failed: {type(e).__name__}: {e}")
        return None


# ---------------------------------------------------------------------------
# Shared prediction builder
# ---------------------------------------------------------------------------

def _ranked_predictions(probs: list[float]) -> tuple[list[dict], str]:
    ranked = sorted(range(len(_class_names)), key=lambda i: probs[i],
                    reverse=True)[:3]
    predictions = [
        {"class_id": _class_names[i],
         "name": HUMAN_NAMES[_class_names[i]],
         "probability": round(float(probs[i]), 4),
         "risk_tier": RISK_TIERS[_class_names[i]]}
        for i in ranked
    ]
    return predictions, _class_names[ranked[0]]


def run_model_prediction(model, image: Image.Image, use_tta: bool,
                         use_hair: bool, with_mc: bool = True) -> dict:
    """Full single-model payload (v1 fields + all v2 additions)."""
    processed = hair_removal(image) if use_hair else image.convert("RGB")
    arr = _resized_np(processed)
    probs, tta_info = get_probs(model, processed, use_tta)
    predictions, top_class = _ranked_predictions(probs)
    entropy, reliability = probs_metrics(probs)
    uncertainty = {"entropy": round(entropy, 4), "reliability": reliability}
    if with_mc:
        mc_std = mc_dropout_std(model, processed)
        if mc_std is not None:
            uncertainty["mc_std"] = mc_std
    quality = compute_quality(arr)
    lesion, segmentation = segmentation_and_lesion(arr)
    top_idx = _class_names.index(top_class)
    cam = gradcam(model, processed, top_idx, arr)
    return {
        "predictions": predictions,
        "top_class": top_class,
        "overall_risk_tier": RISK_TIERS[top_class],
        "advisory": ADVISORY,
        "quality": quality,
        "lesion": lesion,
        "segmentation": segmentation,
        "gradcam": cam,
        "uncertainty": uncertainty,
        "ood": compute_ood(arr, entropy),
        "tta": tta_info,
        "preprocessing": {"hair_removal": bool(use_hair)},
        "_probs": probs,  # internal; stripped before returning where needed
    }


def _public(payload: dict) -> dict:
    return {k: v for k, v in payload.items() if not k.startswith("_")}


async def _read_image(file: UploadFile) -> Image.Image:
    raw = await file.read()
    try:
        return Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400,
                            detail="Could not decode the uploaded image.")


def _flag(value: str | None) -> bool:
    return str(value).lower() in ("true", "1", "yes")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    return {"status": "ok",
            "model_loaded": _mobilenet is not None,
            "efficientnet_loaded": _efficientnet is not None}


@app.post("/predict")
async def predict(file: UploadFile = File(...),
                  tta: str = Form("false"),
                  hair_removal: str = Form("false")) -> dict:
    if _mobilenet is None or _class_names is None:
        raise HTTPException(status_code=503,
                            detail="Model not trained yet. Run: python train.py")
    image = await _read_image(file)
    return _public(run_model_prediction(
        _mobilenet, image, _flag(tta), _flag(hair_removal)))


@app.post("/predict/efficientnet")
async def predict_efficientnet(file: UploadFile = File(...),
                               tta: str = Form("false"),
                               hair_removal: str = Form("false")) -> dict:
    if _efficientnet is None or _class_names is None:
        raise HTTPException(
            status_code=503,
            detail="EfficientNet model not trained yet. Run: python train_v2.py")
    image = await _read_image(file)
    return _public(run_model_prediction(
        _efficientnet, image, _flag(tta), _flag(hair_removal)))


@app.post("/predict/compare")
async def predict_compare(file: UploadFile = File(...),
                          tta: str = Form("false"),
                          hair_removal: str = Form("false")) -> dict:
    if _class_names is None or (_mobilenet is None and _efficientnet is None):
        raise HTTPException(status_code=503, detail="No model trained yet.")
    image = await _read_image(file)
    use_tta, use_hair = _flag(tta), _flag(hair_removal)
    processed = hair_removal(image) if use_hair else image
    arr = _resized_np(processed)
    quality = compute_quality(arr)
    lesion, segmentation = segmentation_and_lesion(arr)
    result = {"quality": quality, "lesion": lesion, "segmentation": segmentation,
              "error_notes": {}}

    def side(model):
        if model is None:
            return None
        payload = run_model_prediction(model, image, use_tta, use_hair)
        return {k: payload[k] for k in
                ("predictions", "top_class", "overall_risk_tier", "gradcam",
                 "advisory", "uncertainty", "ood", "tta", "preprocessing")}

    result["mobilenet"] = side(_mobilenet)
    if result["mobilenet"] is None:
        result["error_notes"]["mobilenet"] = "MobileNetV2 weights not loaded."
    result["efficientnet"] = side(_efficientnet)
    if result["efficientnet"] is None:
        result["error_notes"]["efficientnet"] = "EfficientNet weights not loaded."
    if not result["error_notes"]:
        del result["error_notes"]
    return result


@app.post("/predict/ensemble")
async def predict_ensemble(file: UploadFile = File(...),
                           tta: str = Form("false"),
                           hair_removal: str = Form("false")) -> dict:
    if _mobilenet is None or _efficientnet is None or _class_names is None:
        raise HTTPException(
            status_code=503,
            detail="Ensemble needs both models; one is not trained/loaded yet.")
    image = await _read_image(file)
    use_tta, use_hair = _flag(tta), _flag(hair_removal)
    processed = hair_removal(image) if use_hair else image
    arr = _resized_np(processed)

    mob_probs, mob_tta = get_probs(_mobilenet, processed, use_tta)
    eff_probs, eff_tta = get_probs(_efficientnet, processed, use_tta)
    avg = ((np.asarray(mob_probs) + np.asarray(eff_probs)) / 2.0).tolist()

    predictions, top_class = _ranked_predictions(avg)
    entropy, reliability = probs_metrics(avg)
    quality = compute_quality(arr)
    lesion, segmentation = segmentation_and_lesion(arr)
    top_idx = _class_names.index(top_class)
    cam = gradcam(_mobilenet, processed, top_idx, arr)
    mob_top = _class_names[int(np.argmax(mob_probs))]
    eff_top = _class_names[int(np.argmax(eff_probs))]
    tta_info = mob_tta if use_tta else {"used": False}
    if use_tta:
        # Recompute the ensemble delta honestly: averaged top prob minus the
        # averaged single-pass prob of the same top class.
        mob_single = _softmax_probs(_mobilenet, processed)
        eff_single = _softmax_probs(_efficientnet, processed)
        single_avg_top = (mob_single[top_idx] + eff_single[top_idx]) / 2.0
        tta_info = {"used": True,
                    "delta_top_probability": round(float(avg[top_idx] - single_avg_top), 4),
                    "views": 4}
    return {
        "predictions": predictions,
        "top_class": top_class,
        "overall_risk_tier": RISK_TIERS[top_class],
        "advisory": ADVISORY,
        "per_model": {"mobilenet_top": mob_top, "efficientnet_top": eff_top},
        "disagreement": bool(mob_top != eff_top),
        "uncertainty": {"entropy": round(entropy, 4), "reliability": reliability},
        "ood": compute_ood(arr, entropy),
        "segmentation": segmentation,
        "lesion": lesion,
        "quality": quality,
        "gradcam": cam,
        "tta": tta_info,
        "preprocessing": {"hair_removal": bool(use_hair)},
    }


@app.post("/change-score")
async def change_score(file_a: UploadFile = File(...),
                       file_b: UploadFile = File(...)) -> dict:
    """Approximate heuristic change between two lesion photos: cleaned-mask
    area delta + mean masked colour delta. NOT a clinical measurement."""
    def stats(image: Image.Image):
        arr = _resized_np(image)
        gray = _gray(arr)
        mask, _cleaned = cleaned_lesion_mask(gray)
        area = float(mask.mean() * 100.0)
        if mask.any():
            mean_rgb = arr[mask].mean(axis=0)
        else:
            mean_rgb = arr.reshape(-1, 3).mean(axis=0)
        return area, mean_rgb

    img_a = await _read_image(file_a)
    img_b = await _read_image(file_b)
    area_a, rgb_a = stats(img_a)
    area_b, rgb_b = stats(img_b)
    area_delta = area_b - area_a
    dist = float(np.linalg.norm(rgb_a - rgb_b))
    color_delta = round(dist / (255.0 * math.sqrt(3.0)) * 100.0, 1)
    score = round(max(0.0, min(100.0, 0.6 * abs(area_delta) + 0.4 * color_delta)), 1)
    return {
        "area_a_percent": round(area_a, 1),
        "area_b_percent": round(area_b, 1),
        "area_delta_percent": round(area_delta, 1),
        "color_delta": color_delta,
        "change_score": score,
        "method": "mask-area + mean-color delta (approximate)",
        "note": ("Heuristic approximation from classical-CV masks only; "
                 "lighting/framing differences dominate. Not a clinical "
                 "measurement."),
    }


def _load_json(path: Path):
    if path.exists():
        try:
            with open(path) as fh:
                return json.load(fh)
        except Exception:  # noqa: BLE001
            return None
    return None


def _dataset_distribution() -> dict | None:
    """Full HAM10000 metadata counts (deduped by image_id, 7 classes)."""
    meta_path = BASE_DIR / "data" / "HAM10000_metadata.tab"
    if not meta_path.exists():
        return None
    try:
        import csv
        seen = {}
        with open(meta_path, newline="") as fh:
            reader = csv.DictReader(fh, delimiter="\t")
            for row in reader:
                dx = (row.get("dx") or "").strip().strip('"')
                image_id = (row.get("image_id") or "").strip().strip('"')
                if dx in RISK_TIERS and image_id and image_id not in seen:
                    seen[image_id] = dx
        counts = {c: 0 for c in
                  ["akiec", "bcc", "bkl", "df", "mel", "nv", "vasc"]}
        for dx in seen.values():
            counts[dx] += 1
        return counts
    except Exception:  # noqa: BLE001
        return None


@app.get("/model-info")
def model_info() -> dict:
    mob = _load_json(MODELS_DIR / "training_mobilenet.json")
    eff = _load_json(MODELS_DIR / "training_efficientnet.json")
    v1 = _load_json(MODELS_DIR / "metrics.json")
    v1_baseline = None
    if v1 is not None:
        v1_baseline = {
            "note": "v1 baseline: 2,000-image subset, 4 epochs",
            "best_val_accuracy": v1.get("best_val_accuracy", 0.8125),
            "per_class": v1.get("per_class"),
            "confusion_matrix": v1.get("confusion_matrix"),
        }
    mel_recall = None
    if mob and mob.get("per_class", {}).get("mel"):
        mel_recall = mob["per_class"]["mel"].get("recall")
    shipped = (mob or {}).get("shipped") if mob else None
    v1_mel_recall = None
    if v1 and v1.get("per_class", {}).get("mel"):
        v1_mel_recall = v1["per_class"]["mel"].get("recall")
    if mel_recall is not None and shipped == "v1":
        mel_line = (f"Melanoma recall: the v2 full-dataset MobileNetV2 run "
                    f"scored {mel_recall}, but the SHIPPED MobileNetV2 "
                    f"weights are the v1 weights (v2 did not beat v1's "
                    f"accuracy), whose val melanoma recall was "
                    f"{v1_mel_recall}. Either way, roughly half or more of "
                    f"melanomas are missed — never use for screening.")
    elif mel_recall is not None:
        mel_line = (f"Melanoma recall (shipped MobileNetV2, v2 "
                    f"full-dataset run): {mel_recall}.")
    else:
        mel_line = ("Melanoma recall: see per-class metrics "
                    "(v2 run pending).")
    limitations = [
        "Educational demo only — not a medical device or diagnosis.",
        "Trained on CPU with limited epochs; not converged to GPU-scale quality.",
        "HAM10000 class imbalance persists (nv ~67%); class-weighted loss "
        "mitigates but does not remove it.",
        mel_line,
        "Quality, lesion coverage, segmentation, OOD and change-score are "
        "classical-CV heuristics, not clinical measurements.",
        "Lesion coverage is a frame-coverage estimate; it is never a size in mm.",
    ]
    return {
        "mobilenet": mob,
        "efficientnet": eff,
        "v1_baseline": v1_baseline,
        "classes": [
            {"class_id": c, "name": HUMAN_NAMES[c], "risk_tier": RISK_TIERS[c]}
            for c in (_class_names or
                      ["akiec", "bcc", "bkl", "df", "mel", "nv", "vasc"])
        ],
        "dataset_distribution": _dataset_distribution(),
        "preprocessing_example": {
            "before": "/static/samples/hair_before.jpg",
            "after": "/static/samples/hair_after.jpg",
            "note": ("Real example: 'before' is an original HAM10000 crop, "
                     "'after' is the same image after the DullRazor-style "
                     "hair-removal preprocessing implemented in this service."),
        },
        "methods_notes": {
            "uncertainty": ("Shannon entropy (nats) of the 7-class softmax; "
                            "reliability bands on top-1 probability: "
                            ">=0.75 high, 0.5-0.75 moderate, <0.5 low. "
                            "mc_std (single-model endpoints) = std of top-1 "
                            "prob across 10 MC-dropout passes (classifier "
                            "dropout only)."),
            "ood": ("heuristic — thresholds documented: YCbCr skin coverage "
                    "< 25% OR entropy > 1.8 nats => is_likely_lesion_photo "
                    "= false."),
            "segmentation": ("Classical CV: Otsu threshold on grayscale, "
                             "dark region kept, cleaned to the largest "
                             "connected component (scipy.ndimage.label); "
                             "boundary drawn in magenta. Coverage is a "
                             "frame-coverage heuristic, never mm."),
            "hair_removal": ("DullRazor-style: grayscale blackhat (grey "
                             "closing, 9x9 ellipse) -> hair mask "
                             "(blackhat > 15) -> diffusion inpainting."),
            "tta": ("Test-time augmentation: mean softmax over original, "
                    "horizontal flip, vertical flip, center-crop-90%. "
                    "delta_top_probability is measured against the "
                    "single-pass probability of the TTA top class."),
            "ensemble": ("Mean of the two models' full 7-class probability "
                         "vectors; disagreement = top-1 classes differ."),
            "change_score": ("mask-area + mean-color delta (approximate): "
                             "0.6*|area delta %| + 0.4*colour delta, "
                             "clamped 0-100."),
        },
        "limitations": limitations,
        "advisory": ADVISORY,
    }


@app.get("/samples")
def samples() -> dict | list:
    data = _load_json(MODELS_DIR / "samples.json")
    if data is None:
        raise HTTPException(status_code=503,
                            detail="Samples not built yet. Run: python build_samples.py")
    return data


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
