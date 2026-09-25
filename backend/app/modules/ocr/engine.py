"""
Module 1 — OCR Extraction with Document Region Localization.

Pipeline:
1. Document Region Localization (Faster R-CNN) — detects semantic regions
2. Targeted OCR — runs on detected text regions for higher accuracy
3. Returns both region detection results and extracted text

Wraps whichever OCR backend is installed behind a stable interface so the
rest of the system never imports `pytesseract` directly. If Tesseract's
binary isn't installed on the host, we fail soft with a clear error the
frontend can surface, instead of crashing the whole scan.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from app.config import get_settings

logger = logging.getLogger(__name__)

try:
    import pytesseract
    from pytesseract import Output

    _TESSERACT_PACKAGE_AVAILABLE = True
except ImportError:  # pragma: no cover
    _TESSERACT_PACKAGE_AVAILABLE = False


def tesseract_binary_available() -> bool:
    """
    True only if the actual Tesseract *executable* is reachable — having the
    `pytesseract` Python package installed is necessary but not sufficient,
    since it's just a thin wrapper that shells out to the binary. Used by
    the health endpoint so the frontend's status badge reflects reality
    instead of a package import that always succeeds after `pip install`.
    """
    if not _TESSERACT_PACKAGE_AVAILABLE:
        return False
    _configure_tesseract()
    try:
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


# Back-compat alias used elsewhere in this module for the soft-fail path below.
_TESSERACT_AVAILABLE = _TESSERACT_PACKAGE_AVAILABLE


@dataclass
class OCRWord:
    text: str
    confidence: float
    box: tuple[int, int, int, int]  # x, y, w, h


@dataclass
class OCRResult:
    raw_text: str
    words: list[OCRWord] = field(default_factory=list)
    mean_confidence: float = 0.0
    engine_available: bool = True
    warning: str | None = None
    # New fields for region-aware OCR
    region_detection: Optional[dict] = None  # Serialized RegionDetectionResult
    text_regions_used: int = 0


def _configure_tesseract() -> None:
    settings = get_settings()
    if settings.TESSERACT_CMD:
        pytesseract.pytesseract.tesseract_cmd = settings.TESSERACT_CMD


def _run_localization(image: np.ndarray, document_type: str) -> Optional[dict]:
    """Run document region localization if enabled and a trained model exists."""
    settings = get_settings()
    if not settings.LOCALIZATION_ENABLED:
        return None

    from pathlib import Path
    model_path = settings.LOCALIZATION_MODEL_PATH
    if not model_path or not Path(model_path).is_file():
        logger.info("Localization skipped — no trained model at %s", model_path)
        return None

    try:
        from app.modules.localization.detector import create_detector

        detector = create_detector(
            model_path=model_path,
            confidence_threshold=settings.LOCALIZATION_CONFIDENCE,
            device=settings.LOCALIZATION_DEVICE,
        )
        result = detector.detect_with_preprocessing(image, document_type)
        return result.to_dict() if result.regions else None
    except Exception as e:
        logger.warning(f"Localization failed, falling back to full-image OCR: {e}")
        return None


def _run_ocr_on_regions(image: np.ndarray, region_result: dict) -> tuple[str, list[OCRWord], float, int]:
    """Run Tesseract OCR on detected text regions."""
    if not _TESSERACT_AVAILABLE:
        return "", [], 0.0, 0
    
    _configure_tesseract()
    
    text_regions = region_result.get("regions", [])
    # Filter for text regions
    text_region_classes = {"name", "surname", "date_of_birth", "date_of_issue", 
                          "date_of_expiry", "document_number", "nationality"}
    
    all_words: list[OCRWord] = []
    all_confidences: list[float] = []
    all_text_parts: list[str] = []
    regions_processed = 0
    
    for region in text_regions:
        if region["class_name"] not in text_region_classes:
            continue
        
        x, y, w, h = region["bbox"]["x"], region["bbox"]["y"], region["bbox"]["w"], region["bbox"]["h"]
        if w <= 0 or h <= 0:
            continue
        
        # Crop region with small padding
        pad = 5
        x1 = max(0, x - pad)
        y1 = max(0, y - pad)
        x2 = min(image.shape[1], x + w + pad)
        y2 = min(image.shape[0], y + h + pad)
        region_img = image[y1:y2, x1:x2]
        
        if region_img.size == 0:
            continue
        
        try:
            data = pytesseract.image_to_data(
                region_img, output_type=Output.DICT, config="--oem 3 --psm 7"  # Single line
            )
        except Exception as e:
            logger.warning(f"OCR failed on region {region['class_name']}: {e}")
            continue
        
        regions_processed += 1
        
        for i, text in enumerate(data["text"]):
            text = text.strip()
            if not text:
                continue
            conf = float(data["conf"][i]) if data["conf"][i] != "-1" else 0.0
            # Adjust box coordinates to global image space
            box = (
                data["left"][i] + x1,
                data["top"][i] + y1,
                data["width"][i],
                data["height"][i]
            )
            all_words.append(OCRWord(text=text, confidence=conf, box=box))
            all_confidences.append(conf)
            all_text_parts.append(text)
    
    mean_conf = sum(all_confidences) / len(all_confidences) if all_confidences else 0.0
    return " ".join(all_text_parts), all_words, round(mean_conf, 2), regions_processed  # type: ignore[return-value]


def _is_mrz_word(text: str) -> bool:
    return "<" in text and len(text) >= 15


def _has_mrz_fragment(words: list[OCRWord]) -> bool:
    return any(_is_mrz_word(w.text) for w in words)


def _mrz_band(gray: np.ndarray, words: list[OCRWord]) -> np.ndarray | None:
    """Crop the horizontal band around an MRZ fragment the main pass found.

    Works wherever the MRZ sits on the page (full-page scans put it well
    above the bottom), unlike a fixed bottom-of-image crop.
    """
    import cv2

    hits = [w for w in words if _is_mrz_word(w.text)]
    if not hits:
        return None
    top = min(w.box[1] for w in hits)
    bottom = max(w.box[1] + w.box[3] for w in hits)
    line_h = max(w.box[3] for w in hits)
    y1 = max(0, int(top - 2.5 * line_h))
    y2 = min(gray.shape[0], int(bottom + 2.5 * line_h))
    band = gray[y1:y2, :]
    if band.size == 0:
        return None
    # Upscale only: binarising thin OCR-B glyphs turns '<' into C/K.
    return cv2.resize(band, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)


def _tesseract_config(document_type: str) -> str:
    """Document-type-specific Tesseract config for better accuracy."""
    base = "--oem 3"
    if document_type in ("passport", "visa"):
        # PSM 6 = uniform block. No whitelist on main pass — visual zone
        # has mixed content (names, dates, places).
        return f"{base} --psm 6 -c preserve_interword_spaces=1"
    if document_type in ("national_id", "aadhar"):
        return f"{base} --psm 4"
    if document_type == "pan":
        return f"{base} --psm 6"
    if document_type == "driving_license":
        return f"{base} --psm 4"
    return f"{base} --psm 6"


def run_ocr(image: np.ndarray, document_type: str = "passport") -> OCRResult:
    """
    Run OCR over a BGR (OpenCV-style) image array with optional region localization.

    Pipeline:
    1. Image preprocessing (deskew, denoise, contrast enhance)
    2. Document Region Localization (Faster R-CNN) — if enabled
    3. Targeted OCR on detected text regions — if localization succeeds
    4. Fallback to full-image OCR — if localization fails or disabled
    5. For passports: second MRZ-tuned pass on the bottom of the page
    """
    from app.modules.ocr.preprocessing import preprocess_for_ocr, preprocess_for_mrz

    # Step 0: Preprocess image for better OCR (orientation detection needs Tesseract configured)
    if _TESSERACT_AVAILABLE:
        _configure_tesseract()
    preprocessed = preprocess_for_ocr(image, document_type)

    # Step 1: Try document region localization
    region_result = _run_localization(image, document_type)

    # Step 2: Run OCR on regions if available
    if region_result and region_result.get("regions"):
        raw_text, words, mean_conf, regions_used = _run_ocr_on_regions(image, region_result)
        return OCRResult(
            raw_text=raw_text,
            words=words,
            mean_confidence=mean_conf,
            region_detection=region_result,
            text_regions_used=regions_used,
        )

    # Step 3: Full-image OCR with preprocessing
    logger.info("Using full-image OCR (localization disabled or failed)")

    if not _TESSERACT_AVAILABLE:
        return OCRResult(
            raw_text="",
            engine_available=False,
            warning=(
                "Tesseract OCR is not installed on this machine. Install the "
                "Tesseract binary and the `pytesseract` package (see "
                "backend/README.md) to enable real text extraction. "
                "Downstream modules will run in degraded mode."
            ),
        )

    _configure_tesseract()
    config = _tesseract_config(document_type)

    try:
        # Run on preprocessed (grayscale, deskewed, denoised) image
        data = pytesseract.image_to_data(
            preprocessed, output_type=Output.DICT, config=config,
        )
    except pytesseract.TesseractNotFoundError:
        return OCRResult(
            raw_text="",
            engine_available=False,
            warning=(
                "Tesseract binary not found on PATH. Set TESSERACT_CMD in "
                "your .env to the full path of tesseract.exe."
            ),
        )

    words: list[OCRWord] = []
    confidences: list[float] = []
    lines: dict[tuple[int, int, int], list[str]] = {}

    for i, text in enumerate(data["text"]):
        text = text.strip()
        if not text:
            continue
        conf = float(data["conf"][i]) if data["conf"][i] != "-1" else 0.0
        box = (data["left"][i], data["top"][i], data["width"][i], data["height"][i])
        words.append(OCRWord(text=text, confidence=conf, box=box))
        confidences.append(conf)
        # Field extractors are label/line based, so keep Tesseract's line structure.
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        lines.setdefault(key, []).append(text)

    main_text = "\n".join(" ".join(parts) for parts in lines.values())
    mean_conf = sum(confidences) / len(confidences) if confidences else 0.0

    # Step 4: For passports/visas, a second MRZ-tuned pass when the main pass
    # did not already return both MRZ lines.
    if document_type in ("passport", "visa"):
        import re
        mrz_like = [l for l in main_text.splitlines()
                    if "<" in l and len(re.sub(r"\s", "", l)) >= 40]
        if len(mrz_like) < 2:
            try:
                mrz_img = _mrz_band(preprocessed, words) if mrz_like or _has_mrz_fragment(words) else None
                if mrz_img is None:
                    mrz_img = preprocess_for_mrz(image)
                mrz_data = pytesseract.image_to_data(
                    mrz_img, output_type=Output.DICT,
                    config="--oem 3 --psm 6 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
                )
                mrz_lines: dict[tuple[int, int, int], list[str]] = {}
                for j, t in enumerate(mrz_data["text"]):
                    if t.strip():
                        k = (mrz_data["block_num"][j], mrz_data["par_num"][j], mrz_data["line_num"][j])
                        mrz_lines.setdefault(k, []).append(t.strip())
                mrz_text = "\n".join("".join(parts) for parts in mrz_lines.values())
                if mrz_text:
                    main_text = main_text + "\n\n" + mrz_text
            except Exception as e:
                logger.warning("MRZ-specific OCR pass failed: %s", e)

    return OCRResult(
        raw_text=main_text,
        words=words,
        mean_confidence=round(mean_conf, 2),
    )
