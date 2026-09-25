"""System status endpoints — the frontend uses these to show which engines
are live and what each model actually is, so a demo never silently degrades
and nobody has to take a model's specs on faith."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import cv2
from fastapi import APIRouter

from app.config import BACKEND_ROOT, get_settings
from app.modules.face.verifier import _STRONG_BACKEND, active_backend, backend_bands, backend_label
from app.modules.ocr.engine import tesseract_binary_available

router = APIRouter(prefix="/api", tags=["system"])

_CLASSIFIER_WEIGHTS = BACKEND_ROOT / "training" / "document_classifier.pth"
_CLASSIFIER_METRICS = BACKEND_ROOT / "training" / "document_classifier_metrics.json"
_YUNET = BACKEND_ROOT / "models" / "face" / "face_detection_yunet_2023mar.onnx"
_SFACE = BACKEND_ROOT / "models" / "face" / "face_recognition_sface_2021dec.onnx"


def _file_info(path: Path) -> dict:
    if not path.is_file():
        return {"present": False}
    stat = path.stat()
    return {
        "present": True,
        "size_mb": round(stat.st_size / 1e6, 1),
        "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    }


def _tesseract_info() -> dict:
    if not tesseract_binary_available():
        return {"available": False}
    import pytesseract

    try:
        return {
            "available": True,
            "version": str(pytesseract.get_tesseract_version()),
            "languages": sorted(l for l in pytesseract.get_languages(config="") if l in ("eng", "hin", "nep", "osd")),
        }
    except Exception as e:
        return {"available": True, "error": str(e)}


@router.get("/health")
async def health():
    settings = get_settings()
    return {
        "status": "ok",
        "app_name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "engines": {
            "ocr": "tesseract" if tesseract_binary_available() else "unavailable",
            "face_verification": backend_label(),
        },
    }


@router.get("/system/models")
async def models():
    settings = get_settings()
    metrics = json.loads(_CLASSIFIER_METRICS.read_text()) if _CLASSIFIER_METRICS.is_file() else None
    loc_path = Path(settings.LOCALIZATION_MODEL_PATH) if settings.LOCALIZATION_MODEL_PATH else None
    loc_weights = BACKEND_ROOT / "models" / "localization" / "fasterrcnn_document_regions.pth"

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "models": [
            {
                "key": "document_classifier",
                "name": "Document-type classifier",
                "kind": "Trained neural network",
                "architecture": "MobileNetV2 (ImageNet-pretrained, final layer retrained)",
                "purpose": "Tells Aadhaar, PAN and passport images apart for auto-detection.",
                "status": "active" if _CLASSIFIER_WEIGHTS.is_file() else "missing",
                "weights": _file_info(_CLASSIFIER_WEIGHTS),
                "classes": metrics["classes"] if metrics else ["aadhar", "pan", "passport"],
                "training": None if not metrics else {
                    "train_images": metrics["train_images"],
                    "validation_images": metrics["validation_images"],
                    "validation_accuracy": metrics["validation_accuracy"],
                    "epochs": metrics["epochs"],
                    "optimizer": metrics["optimizer"],
                    "input_size": metrics["input_size"],
                    "per_class": metrics["per_class"],
                    "confusion_matrix": metrics["confusion_matrix"],
                },
                "caveat": "Validation images come from the same synthetic templates as training, so "
                          "accuracy on real-world photos is not yet measured.",
            },
            {
                "key": "region_detector",
                "name": "Document region detector",
                "kind": "Trained neural network",
                "architecture": "Faster R-CNN, ResNet-50 FPN backbone",
                "purpose": "Would locate photo / MRZ / name regions before OCR.",
                "status": "active" if (settings.LOCALIZATION_ENABLED and loc_path and loc_path.is_file()) else "disabled",
                "weights": _file_info(loc_weights),
                "caveat": "Trained only on generated documents; left disabled until fine-tuned on "
                          "annotated real scans. OCR reads the whole image instead.",
            },
            {
                "key": "ocr",
                "name": "Text recognition (OCR)",
                "kind": "OCR engine",
                "architecture": "Tesseract LSTM",
                "purpose": "Reads printed text and the passport MRZ; fields are then parsed by format-aware extractors.",
                "status": "active" if tesseract_binary_available() else "missing",
                "details": _tesseract_info(),
            },
            {
                "key": "face_detector",
                "name": "Face detector",
                "kind": "Trained neural network" if _YUNET.is_file() else "Classical computer vision",
                "architecture": "OpenCV YuNet face detector (Haar cascade as fallback)" if _YUNET.is_file()
                else "OpenCV Haar cascade (frontal face)",
                "purpose": "Finds every face on the document and picks the holder's portrait by photo quality "
                           "(contrast, tonal range, sharpness) so ghost images and watermarks are skipped.",
                "status": "active",
                "weights": _file_info(_YUNET),
                "details": {"opencv_version": cv2.__version__},
            },
            {
                "key": "face_matcher",
                "name": "Face matcher",
                "kind": "Trained neural network" if _STRONG_BACKEND else "Classical computer vision",
                "architecture": backend_label(),
                "purpose": "Compares the document portrait with the live photo: match / inconclusive / different person.",
                "status": "active",
                "weights": _file_info(_SFACE) if _SFACE.is_file() else None,
                "details": {
                    "backend": active_backend(),
                    "match_at_or_above": backend_bands()[0],
                    "different_person_below": backend_bands()[1],
                },
                "caveat": None if _STRONG_BACKEND else (
                    "Not a face-recognition model; bands measured on dataset portraits only. Put OpenCV's "
                    "face_recognition_sface_2021dec.onnx in backend/models/face/ to switch to a real recognition network."
                ),
            },
            {
                "key": "tampering",
                "name": "Tampering forensics",
                "kind": "Classical image forensics",
                "architecture": "Error Level Analysis + copy-move (ORB displacement clustering) + metadata",
                "purpose": "Looks for pasted, cloned or re-edited regions.",
                "status": "active",
                "details": {
                    "ela_jpeg_quality": settings.ELA_JPEG_QUALITY,
                    "copy_move_alarm_pairs": settings.COPY_MOVE_MATCH_THRESHOLD,
                    "weights": {"ela": 0.7, "copy_move": 0.15, "metadata": 0.15},
                },
            },
        ],
        "risk_engine": {
            "weights": {
                "validation": settings.WEIGHT_VALIDATION,
                "tampering": settings.WEIGHT_TAMPERING,
                "face": settings.WEIGHT_FACE,
                "records": settings.WEIGHT_RECORDS,
            },
            "clear_max": settings.RISK_CLEAR_MAX,
            "review_max": settings.RISK_REVIEW_MAX,
        },
        "records_database": "configured" if settings.DATABASE_URL else "in-process only",
    }
