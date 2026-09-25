# AI-Based Fake Identity & Document Screening System - Training Plan

**Goal:** Train a document type classifier to automatically identify uploaded documents as Aadhar, PAN, or Passport, and integrate it into the backend.

**Architecture:**
1.  **Dataset Preparation:** Consolidate the provided synthetic document images into a structured format suitable for training.
2.  **Model Definition:** Define a lightweight Convolutional Neural Network (CNN) for document classification.
3.  **Training Script:** Develop a script to train the model using PyTorch.
4.  **Backend Integration:** Integrate the trained model into the backend to automatically predict document types.
5.  **API Integration:** Update the API to use the classifier.

**Tech Stack:**
*   Python 3.10+
*   PyTorch
*   torchvision
*   Pillow
*   FastAPI (for integration)

---

## Task 1: Dataset Preparation

**Objective:** Organize the provided datasets into a standard directory structure for training.

**Files:**
*   Create: `backend/training/data/organize_dataset.py`
*   Create: `backend/training/data/aadhar/`
*   Create: `backend/training/data/pan/`
*   Create: `backend/training/data/passport/`

**Steps:**

1.  **Create the directory structure:**
    ```bash
    mkdir -p backend/training/data/aadhar
    mkdir -p backend/training/data/pan
    mkdir -p backend/training/data/passport
    ```

2.  **Write the `organize_dataset.py` script:**
    This script will copy images from the source directories to the new structure.

    ```python
    import shutil
    from pathlib import Path

    def organize_data():
        base_src = Path("D:/Projects/SIH26/DATASET")
        base_dst = Path("backend/training/data")

        # Aadhar
        src_aadhar = base_src / "aadhar images"
        dst_aadhar = base_dst / "aadhar"
        for img in src_aadhar.glob("*.jpg"):
            shutil.copy(img, dst_aadhar / img.name)

        # PAN
        src_pan = base_src / "pann"
        dst_pan = base_dst / "pan"
        for img in src_pan.glob("*.png"):
            shutil.copy(img, dst_pan / img.name)

        # Passport
        src_passport = base_src / "PASSPORT images"
        dst_passport = base_dst / "passport"
        for img in src_passport.glob("*.jpg"):
            shutil.copy(img, dst_passport / img.name)

    if __name__ == "__main__":
        organize_data()
    ```

3.  **Run the organization script:**
    ```bash
    python backend/training/data/organize_dataset.py
    ```

---

## Task 2: Model Definition

**Objective:** Define the CNN architecture for document classification.

**Files:**
*   Create: `backend/training/model.py`

**Steps:**

1.  **Define the `DocumentClassifier` class in `model.py`:**
    ```python
    import torch.nn as nn
    import torchvision.models as models

    class DocumentClassifier(nn.Module):
        def __init__(self, num_classes=3):
            super(DocumentClassifier, self).__init__()
            # Use a lightweight pretrained model
            self.backbone = models.mobilenet_v2(pretrained=True)
            # Replace the final classifier
            num_ftrs = self.backbone.classifier[1].in_features
            self.backbone.classifier[1] = nn.Linear(num_ftrs, num_classes)

        def forward(self, x):
            return self.backbone(x)
    ```

---

## Task 3: Training Script

**Objective:** Develop the training loop and data loading logic.

**Files:**
*   Create: `backend/training/train.py`

**Steps:**

1.  **Implement the training script `train.py`:**
    This script will handle data loading, training, and saving the model.

    ```python
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import DataLoader
    from torchvision import datasets, transforms
    from model import DocumentClassifier

    def train():
        # Data transforms
        transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        ])

        # Load dataset
        data_dir = "backend/training/data"
        dataset = datasets.ImageFolder(data_dir, transform=transform)
        dataloader = DataLoader(dataset, batch_size=32, shuffle=True)

        # Model, loss, optimizer
        model = DocumentClassifier(num_classes=len(dataset.classes))
        criterion = nn.CrossEntropyLoss()
        optimizer = optim.Adam(model.parameters(), lr=0.001)

        # Training loop
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        model.to(device)

        epochs = 5
        for epoch in range(epochs):
            model.train()
            running_loss = 0.0
            for inputs, labels in dataloader:
                inputs, labels = inputs.to(device), labels.to(device)

                optimizer.zero_grad()
                outputs = model(inputs)
                loss = criterion(outputs, labels)
                loss.backward()
                optimizer.step()

                running_loss += loss.item()

            print(f"Epoch {epoch+1}/{epochs}, Loss: {running_loss/len(dataloader)}")

        # Save model
        torch.save(model.state_dict(), "backend/training/document_classifier.pth")
        print("Model saved.")

    if __name__ == "__main__":
        train()
    ```

2.  **Run the training script:**
    ```bash
    python backend/training/train.py
    ```

---

## Task 4: Backend Integration

**Objective:** Integrate the trained model into the backend for inference.

**Files:**
*   Create: `backend/app/modules/classification/classifier.py`
*   Modify: `backend/app/api/routes_documents.py`

**Steps:**

1.  **Create the classifier module `classifier.py`:**
    ```python
    import torch
    from torchvision import transforms
    from PIL import Image
    import io
    from app.modules.classification.model import DocumentClassifier

    class DocumentTypeClassifier:
        def __init__(self, model_path="backend/training/document_classifier.pth"):
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            self.model = DocumentClassifier(num_classes=3)
            self.model.load_state_dict(torch.load(model_path, map_location=self.device))
            self.model.eval()

            self.classes = ["aadhar", "pan", "passport"]
            self.transform = transforms.Compose([
                transforms.Resize((224, 224)),
                transforms.ToTensor(),
                transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
            ])

        def predict(self, image_bytes: bytes) -> str:
            image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            image = self.transform(image).unsqueeze(0).to(self.device)

            with torch.no_grad():
                outputs = self.model(image)
                _, predicted = torch.max(outputs, 1)

            return self.classes[predicted.item()]

    classifier = DocumentTypeClassifier()
    ```

2.  **Update `routes_documents.py` to use the classifier:**
    *   Import the classifier.
    *   Add an endpoint or logic to predict the document type if not provided.

    ```python
    # Add import
    from app.modules.classification.classifier import classifier

    # In scan_document function, before Module 1
    if document_type == "auto":
        document_type = classifier.predict(doc_bytes)
        # Map to valid types if necessary
    ```

---

## Task 5: API Integration

**Objective:** Expose the classification via an API endpoint.

**Files:**
*   Modify: `backend/app/api/routes_documents.py`

**Steps:**

1.  **Add a new endpoint for classification:**
    ```python
    @router.post("/classify")
    async def classify_document(document: UploadFile = File(...)):
        doc_bytes = await _read_upload(document)
        doc_type = classifier.predict(doc_bytes)
        return {"document_type": doc_type}
    ```

---

## Task 6: Final Review and Testing

**Objective:** Verify the integration and test the endpoint.

**Steps:**

1.  **Run the backend:**
    ```bash
    cd backend
    uvicorn app.main:app --reload
    ```

2.  **Test the classification endpoint:**
    Use curl or Postman to upload an image and verify the predicted type.

    ```bash
    curl -X POST "http://localhost:8000/api/documents/classify" -F "document=@path/to/image.jpg"
    ```

3.  **Verify the scan endpoint with `document_type="auto"`:**
    Ensure the system correctly identifies the document and processes it.
