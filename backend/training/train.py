"""
Train the document-type classifier (MobileNetV2, ImageNet-pretrained) on
training/data/<class>/*.jpg with a stratified, seeded 80/20 train/validation
split, and write held-out metrics next to the weights.

Usage (from backend/):
    .venv\\Scripts\\python training\\train.py [--epochs 5] [--out training/document_classifier.pth]
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from collections import defaultdict
from pathlib import Path

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, Subset
from torchvision import datasets, transforms

HERE = Path(__file__).resolve().parent
sys.path.append(str(HERE.parent / "app" / "modules" / "classification"))
from model import DocumentClassifier  # noqa: E402

SEED = 26188
NORMALIZE = transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])


def stratified_split(targets: list[int], val_fraction: float) -> tuple[list[int], list[int]]:
    by_class: dict[int, list[int]] = defaultdict(list)
    for idx, t in enumerate(targets):
        by_class[t].append(idx)
    rng = random.Random(SEED)
    train_idx, val_idx = [], []
    for idxs in by_class.values():
        rng.shuffle(idxs)
        n_val = max(1, int(len(idxs) * val_fraction))
        val_idx.extend(idxs[:n_val])
        train_idx.extend(idxs[n_val:])
    return train_idx, val_idx


def evaluate(model, loader, device, num_classes):
    model.eval()
    confusion = [[0] * num_classes for _ in range(num_classes)]
    with torch.no_grad():
        for inputs, labels in loader:
            preds = model(inputs.to(device)).argmax(1).cpu()
            for t, p in zip(labels.tolist(), preds.tolist()):
                confusion[t][p] += 1
    correct = sum(confusion[i][i] for i in range(num_classes))
    total = sum(sum(r) for r in confusion)
    return correct / max(total, 1), confusion


def train(epochs: int, out_path: Path, val_fraction: float) -> None:
    torch.manual_seed(SEED)
    data_dir = HERE / "data"

    train_tf = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.RandomRotation(5),
        transforms.ColorJitter(brightness=0.2, contrast=0.2),
        transforms.ToTensor(),
        NORMALIZE,
    ])
    eval_tf = transforms.Compose([transforms.Resize((224, 224)), transforms.ToTensor(), NORMALIZE])

    base = datasets.ImageFolder(str(data_dir))
    classes = base.classes
    train_idx, val_idx = stratified_split(base.targets, val_fraction)
    train_ds = Subset(datasets.ImageFolder(str(data_dir), transform=train_tf), train_idx)
    val_ds = Subset(datasets.ImageFolder(str(data_dir), transform=eval_tf), val_idx)
    print(f"Classes: {classes} | total {len(base)} | train {len(train_ds)} | validation {len(val_ds)}")

    train_loader = DataLoader(train_ds, batch_size=32, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=32)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = DocumentClassifier(num_classes=len(classes)).to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)

    history = []
    start = time.time()
    for epoch in range(1, epochs + 1):
        model.train()
        running, correct, total = 0.0, 0, 0
        for inputs, labels in train_loader:
            inputs, labels = inputs.to(device), labels.to(device)
            optimizer.zero_grad()
            outputs = model(inputs)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()
            running += loss.item()
            correct += (outputs.argmax(1) == labels).sum().item()
            total += labels.size(0)
        val_acc, _ = evaluate(model, val_loader, device, len(classes))
        row = {
            "epoch": epoch,
            "train_loss": round(running / len(train_loader), 4),
            "train_accuracy": round(correct / total, 4),
            "val_accuracy": round(val_acc, 4),
        }
        history.append(row)
        print(row, flush=True)

    val_acc, confusion = evaluate(model, val_loader, device, len(classes))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), out_path)

    per_class = {}
    for i, name in enumerate(classes):
        support = sum(confusion[i])
        predicted = sum(confusion[r][i] for r in range(len(classes)))
        tp = confusion[i][i]
        per_class[name] = {
            "support": support,
            "precision": round(tp / predicted, 4) if predicted else 0.0,
            "recall": round(tp / support, 4) if support else 0.0,
        }

    metrics = {
        "architecture": "MobileNetV2 (torchvision, ImageNet-1K pretrained), final Linear layer replaced",
        "classes": classes,
        "input_size": [224, 224],
        "optimizer": "Adam lr=0.001",
        "epochs": epochs,
        "seed": SEED,
        "train_images": len(train_ds),
        "validation_images": len(val_ds),
        "validation_accuracy": round(val_acc, 4),
        "per_class": per_class,
        "confusion_matrix": {"rows_true_cols_pred": classes, "matrix": confusion},
        "history": history,
        "training_seconds": round(time.time() - start, 1),
        "device": str(device),
    }
    metrics_path = out_path.with_name(out_path.stem + "_metrics.json")
    metrics_path.write_text(json.dumps(metrics, indent=2))
    print(f"Saved weights -> {out_path}\nSaved metrics -> {metrics_path}\nValidation accuracy: {val_acc:.2%}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--val-fraction", type=float, default=0.2)
    parser.add_argument("--out", type=Path, default=HERE / "document_classifier.pth")
    args = parser.parse_args()
    out = args.out.resolve()
    os.chdir(HERE)
    train(args.epochs, out, args.val_fraction)
