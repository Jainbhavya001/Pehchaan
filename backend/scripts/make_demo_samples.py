"""
Build demo images for the screening pipeline from a dataset passport page.

The synthetic passports in training/data/passport print MRZ check digits that
do not follow ICAO 9303, so every one of them (correctly) fails validation.
This script re-prints the MRZ of one page with correct check digits and makes
three variants:

  demo_passport_genuine.jpg   internally consistent            -> expect CLEAR
  demo_passport_tampered.jpg  expiry year altered in the MRZ   -> checksum fails, HIGH RISK
  demo_passport_clone.jpg     same passport number, new name   -> records conflict once
                                                                  the genuine one is on file

Usage (from backend/):  .venv\\Scripts\\python scripts\\make_demo_samples.py
Output: ../sample-data/
"""
from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np
import pytesseract
from PIL import Image, ImageDraw, ImageFont

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.modules.ocr.engine import _configure_tesseract  # noqa: E402
from app.modules.ocr.mrz_parser import compute_check_digit  # noqa: E402

SOURCE = BACKEND / "training" / "data" / "passport" / "PASSPORT dataset batch 1_Page_005.jpg"
OUT = BACKEND.parent / "sample-data"

HOLDER = {
    "surname": "SHARMA", "given": "GEETA", "number": "O2453770", "nationality": "IND",
    "dob": "800417", "sex": "F", "expiry": "330522",
}


def mrz_lines(surname: str, given: str, number: str, nat: str, dob: str, sex: str, expiry: str,
              tamper_expiry: str | None = None) -> tuple[str, str]:
    line1 = f"P<{nat}{surname}<<{given.replace(' ', '<')}".ljust(44, "<")[:44]
    doc = number.ljust(9, "<")
    personal = "<" * 14
    doc_cd = compute_check_digit(doc)
    dob_cd = compute_check_digit(dob)
    exp_cd = compute_check_digit(expiry)
    pers_cd = compute_check_digit(personal)
    composite = compute_check_digit(f"{doc}{doc_cd}{dob}{dob_cd}{expiry}{exp_cd}{personal}{pers_cd}")
    printed_expiry = tamper_expiry or expiry  # forger edits the date but cannot fix the check digits
    line2 = f"{doc}{doc_cd}{nat}{dob}{dob_cd}{sex}{printed_expiry}{exp_cd}{personal}{pers_cd}{composite}"
    return line1, line2


def find_mrz_box(gray: np.ndarray) -> tuple[int, int, int, int]:
    data = pytesseract.image_to_data(gray, output_type=pytesseract.Output.DICT, config="--oem 3 --psm 6")
    boxes = [(data["left"][i], data["top"][i], data["width"][i], data["height"][i])
             for i, t in enumerate(data["text"]) if "<" in t and len(t.strip()) >= 15]
    if not boxes:
        raise SystemExit("Could not locate the MRZ on the source page.")
    x = min(b[0] for b in boxes)
    bottom = max(b[1] + b[3] for b in boxes)
    h = max(b[3] for b in boxes)
    return x, bottom - 2 * h - int(1.6 * h), gray.shape[1] - x, 2 * h + int(2.2 * h)


def render(page: np.ndarray, box, line1: str, line2: str, name_patch: str | None = None) -> np.ndarray:
    img = Image.fromarray(cv2.cvtColor(page, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(img)
    x, y, w, h = box
    bg = tuple(int(c) for c in np.median(page[y:y + h, x:x + w].reshape(-1, 3), axis=0)[::-1])
    draw.rectangle([x - 4, y, x + w - 20, y + h], fill=bg)
    font = ImageFont.truetype("cour.ttf", max(16, int(h * 0.36)))
    draw.text((x, y + int(h * 0.08)), line1, fill=(20, 20, 20), font=font)
    draw.text((x, y + int(h * 0.52)), line2, fill=(20, 20, 20), font=font)
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


def main() -> None:
    _configure_tesseract()
    OUT.mkdir(exist_ok=True)
    full = cv2.imread(str(SOURCE))
    page = full[: int(full.shape[0] * 0.25)].copy()  # page 1 of the two-page scan
    box = find_mrz_box(cv2.cvtColor(page, cv2.COLOR_BGR2GRAY))

    genuine = render(page, box, *mrz_lines(**_args(HOLDER)))
    cv2.imwrite(str(OUT / "demo_passport_genuine.jpg"), genuine, [cv2.IMWRITE_JPEG_QUALITY, 95])

    tampered = render(page, box, *mrz_lines(**_args(HOLDER), tamper_expiry="380522"))
    cv2.imwrite(str(OUT / "demo_passport_tampered.jpg"), tampered, [cv2.IMWRITE_JPEG_QUALITY, 95])

    clone = dict(HOLDER, surname="VERMA", given="RAKESH", sex="M", dob="770309")
    cloned = render(page, box, *mrz_lines(**_args(clone)))
    cv2.imwrite(str(OUT / "demo_passport_clone.jpg"), cloned, [cv2.IMWRITE_JPEG_QUALITY, 95])

    print("Wrote:", *sorted(p.name for p in OUT.glob("demo_passport_*.jpg")), sep="\n  ")


def _args(h: dict) -> dict:
    return {"surname": h["surname"], "given": h["given"], "number": h["number"], "nat": h["nationality"],
            "dob": h["dob"], "sex": h["sex"], "expiry": h["expiry"]}


if __name__ == "__main__":
    main()
