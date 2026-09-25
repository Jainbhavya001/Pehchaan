import shutil
from pathlib import Path

def organize_data():
    base_src = Path("D:/Projects/SIH26/DATASET")
    base_dst = Path("D:/Projects/SIH26/SIH-2026/backend/training/data")

    # Aadhar
    src_aadhar = base_src / "aadhar images"
    dst_aadhar = base_dst / "aadhar"
    if src_aadhar.exists():
        for img in src_aadhar.glob("*.jpg"):
            shutil.copy(img, dst_aadhar / img.name)
        print(f"Copied {len(list(dst_aadhar.glob('*.jpg')))} Aadhar images.")
    else:
        print(f"Source not found: {src_aadhar}")

    # PAN
    src_pan = base_src / "pann"
    dst_pan = base_dst / "pan"
    if src_pan.exists():
        for img in src_pan.glob("*.png"):
            shutil.copy(img, dst_pan / img.name)
        print(f"Copied {len(list(dst_pan.glob('*.png')))} PAN images.")
    else:
        print(f"Source not found: {src_pan}")

    # Passport
    src_passport = base_src / "PASSPORT images"
    dst_passport = base_dst / "passport"
    if src_passport.exists():
        for img in src_passport.glob("*.jpg"):
            shutil.copy(img, dst_passport / img.name)
        print(f"Copied {len(list(dst_passport.glob('*.jpg')))} Passport images.")
    else:
        print(f"Source not found: {src_passport}")

if __name__ == "__main__":
    organize_data()
