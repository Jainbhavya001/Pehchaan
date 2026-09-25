# Bibliography & Documentation Index

**Project:** Pehchaan — AI-Based Fake Identity & Document Screening System  
**SIH Problem Statement:** 26188  
**Organization:** Ministry of Home Affairs — Sashastra Seema Bal (SSB), Police II Division  
**Category:** Software | **Theme:** Blockchain & Cybersecurity

---

## 1. Project Documentation

### 1.1 Core Project Documents

| Document | Path | Description |
|----------|------|-------------|
| **Project README** | [`README.md`](README.md) | Main project overview, quick start, architecture summary, module breakdown, and implementation status |
| **Problem Statement** | [`docs/PROBLEM_STATEMENT.md`](docs/PROBLEM_STATEMENT.md) | Original SIH 26188 brief — background, detailed description, 4 modules, expected impact |
| **System Architecture** | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | High-level flow, technology choices, module breakdown, API surface, data flow & audit trail |
| **API Reference** | [`docs/API.md`](docs/API.md) | Complete API specification — endpoints, request/response schemas, examples |
| **Project Summary (Target Architecture)** | [`pipeline imp recs/project_summary.md`](pipeline%20imp%20recs/project_summary.md) | Target architecture with Kafka, Hyperledger Fabric, PRNU, ArcFace, LayoutLM — **aspirational, not yet implemented** |
| **Architecture Diagram (PDF)** | [`pipeline imp recs/AI_Document_Screening_System_Architecture.pdf`](pipeline%20imp%20recs/AI_Document_Screening_System_Architecture.pdf) | Visual architecture diagram |

### 1.2 Implementation Plans & Roadmaps

| Document | Path | Description |
|----------|------|-------------|
| **Document Classifier Training Plan** | [`docs/plans/2026-09-16-document-classifier-training.md`](docs/plans/2026-09-16-document-classifier-training.md) | Step-by-step plan for training Aadhar/PAN/Passport classifier with PyTorch |
| **First Audit Report** | [`1st_AUDIT.md`](1st_AUDIT.md) | Brutal audit of codebase — architecture gaps, security issues, module-by-module teardown |
| **Implementation Roadmap (24h Sprint)** | *See conversation history* | Condensed 24-hour solo execution plan prioritizing Faster R-CNN integration |

### 1.3 Module-Specific Documentation

| Document | Path | Description |
|----------|------|-------------|
| **Backend README** | [`backend/README.md`](backend/README.md) | Setup instructions, OCR/face backend notes, test commands, Docker usage |
| **Frontend README** | [`frontend/README.md`](frontend/README.md) | Setup, design system notes, build instructions, Tailwind configuration |

---

## 2. Technical Standards & Specifications

### 2.1 ICAO Standards (Core to MRZ Parsing)

| Standard | Reference | Usage in Project |
|----------|-----------|------------------|
| **ICAO Doc 9303** | [ICAO Machine Readable Travel Documents](https://www.icao.int/publications/pages/publication.aspx?docnum=9303) | **Primary reference** — TD3 (passport) and TD1 (ID card) MRZ format, check digit algorithm (weight 7-3-1), character encoding |
| **ICAO Doc 9303 Part 4** | Section 4.9 (Check Digit Algorithm), Section 4.2.2 (TD3 Layout) | Implemented in [`backend/app/modules/ocr/mrz_parser.py`](backend/app/modules/ocr/mrz_parser.py) — verified against canonical worked example (Anna Maria Eriksson, Utopia passport) |

### 2.2 Digital Forensics Techniques (Tampering Detection)

| Technique | Reference | Implementation |
|-----------|-----------|----------------|
| **Error Level Analysis (ELA)** | Krawetz, N. "Digital Image Error Level Analysis" (FotoForensics) | [`backend/app/modules/tampering/ela.py`](backend/app/modules/tampering/ela.py) — JPEG recompression at Q90, diff analysis, heatmap generation |
| **Copy-Move Detection (ORB)** | Christlein et al. "An Evaluation of Popular Copy-Move Forgery Detection Approaches" (IEEE TIFS 2012) | [`backend/app/modules/tampering/copy_move.py`](backend/app/modules/tampering/copy_move.py) — ORB self-matching with distance filtering |
| **Metadata/EXIF Analysis** | EXIF 2.3 Specification, CIPA DC-008 | [`backend/app/modules/tampering/metadata_analysis.py`](backend/app/modules/tampering/metadata_analysis.py) — Software tag detection, timestamp consistency |
| **PRNU (Photo-Response Non-Uniformity)** | Fridrich et al. "Digital Image Forensics Using Sensor Pattern Noise" (IEEE TIFS 2006) | **Planned** — sensor fingerprint analysis for cross-device splice detection |

### 2.3 Face Verification Standards

| Standard/Model | Reference | Implementation |
|----------------|-----------|----------------|
| **ArcFace (Additive Angular Margin Loss)** | Deng et al. "ArcFace: Additive Angular Margin Loss for Deep Face Recognition" (CVPR 2019) | **Planned/Integration** — via InsightFace (`insightface==0.7.3`) with ONNX runtime |
| **InsightFace SCRFD** | Guo et al. "SCRFD: Sample and Computation Redistribution for Efficient Face Detection" (arXiv 2021) | **Planned** — replaces Haar cascade for face detection |
| **MiniFASNet (Silent Face Anti-Spoofing)** | Liu et al. "Deep Tree Learning for Zero-Shot Face Anti-Spoofing" (CVPR 2021) | **Planned** — passive liveness detection (print/screen replay attack prevention) |
| **ISO/IEC 19794-5** | Face image data interchange format | Reference for face image quality assessment |

### 2.4 Object Detection (Faster R-CNN Integration)

| Component | Reference | Implementation |
|-----------|-----------|----------------|
| **Faster R-CNN** | Ren et al. "Faster R-CNN: Towards Real-Time Object Detection with Region Proposal Networks" (NIPS 2015) | [`backend/app/modules/localization/detector.py`](backend/app/modules/localization/detector.py) — torchvision `fasterrcnn_resnet50_fpn_v2` |
| **ResNet-50 FPN Backbone** | Lin et al. "Feature Pyramid Networks for Object Detection" (CVPR 2017) | Built into torchvision Faster R-CNN |
| **Document Layout Analysis** | Pfitzmann et al. "Figure and Table Detection in Document Images" (ICDAR 2022) | Synthetic generator creates training data for document region classes |

---

## 3. Codebase Module Reference

### 3.1 Backend Modules

| Module | Path | Purpose | Key Classes/Functions |
|--------|------|---------|----------------------|
| **App Entry** | [`backend/app/main.py`](backend/app/main.py) | FastAPI app, CORS, router wiring | `app`, `root()` |
| **Configuration** | [`backend/app/config.py`](backend/app/config.py) | Environment-driven settings | `Settings`, `get_settings()` |
| **API Schemas** | [`backend/app/models/schemas.py`](backend/app/models/schemas.py) | Pydantic wire contracts | `ScanResponse`, `OCRSummary`, `MRZSummary`, `ValidationSummary`, `TamperingSummary`, `FaceSummary`, `RiskSummary` |
| **Storage** | [`backend/app/storage/file_store.py`](backend/app/storage/file_store.py) | In-memory audit trail (prototype) | `save_scan()`, `get_scan()`, `list_scans()`, `stats()` |

#### Module 1 — OCR Extraction
| File | Path | Purpose |
|------|------|---------|
| **OCR Engine** | [`backend/app/modules/ocr/engine.py`](backend/app/modules/ocr/engine.py) | PaddleOCR/Tesseract wrapper, lazy init, graceful degradation | `run_ocr()`, `OCRResult`, `OCRWord` |
| **MRZ Parser** | [`backend/app/modules/ocr/mrz_parser.py`](backend/app/modules/ocr/mrz_parser.py) | ICAO 9303 TD3 parser, check digit validation | `parse_mrz()`, `compute_check_digit()`, `MRZResult`, `MRZField` |
| **Field Extractors** | [`backend/app/modules/ocr/field_extractors.py`](backend/app/modules/ocr/field_extractors.py) | Regex/heuristic extraction for non-MRZ docs | `extract_fields()`, `EXTRACTORS` dict |

#### Module 2 — Document Validation
| File | Path | Purpose |
|------|------|---------|
| **Validation Schemas** | [`backend/app/modules/validation/schemas.py`](backend/app/modules/validation/schemas.py) | Pydantic domain schemas per document type | `PassportFields`, `VisaFields`, `KNOWN_COUNTRY_CODES` |
| **Rules Engine** | [`backend/app/modules/validation/rules_engine.py`](backend/app/modules/validation/rules_engine.py) | Explainable rule checks (checksum, expiry, age, cross-field) | `validate_passport()`, `validate_generic()`, `ValidationResult`, `ValidationIssue` |

#### Module 3 — Tampering Detection
| File | Path | Purpose |
|------|------|---------|
| **ELA** | [`backend/app/modules/tampering/ela.py`](backend/app/modules/tampering/ela.py) | Error Level Analysis with heatmap | `run_ela()`, `ELAResult` |
| **Copy-Move** | [`backend/app/modules/tampering/copy_move.py`](backend/app/modules/tampering/copy_move.py) | ORB self-similarity for clone detection | `detect_copy_move()`, `CopyMoveResult` |
| **Metadata** | [`backend/app/modules/tampering/metadata_analysis.py`](backend/app/modules/tampering/metadata_analysis.py) | EXIF/software tag forensics | `analyze_metadata()`, `MetadataResult` |
| **Tampering Engine** | [`backend/app/modules/tampering/tampering_engine.py`](backend/app/modules/tampering/tampering_engine.py) | Multi-signal fusion (ELA 50%, Copy-Move 35%, Metadata 15%) | `analyze_tampering()`, `TamperingResult` |

#### Module 4 — Face Verification
| File | Path | Purpose |
|------|------|---------|
| **Detector** | [`backend/app/modules/face/detector.py`](backend/app/modules/face/detector.py) | Haar cascade face detection (fallback) | `detect_largest_face()`, `FaceBox` |
| **Verifier** | [`backend/app/modules/face/verifier.py`](backend/app/modules/face/verifier.py) | Histogram+ORB similarity (fallback), pluggable for `face_recognition` | `compare_faces()`, `FaceMatchResult` |

#### Module 5 — Risk Fusion
| File | Path | Purpose |
|------|------|---------|
| **Risk Engine** | [`backend/app/modules/risk/risk_engine.py`](backend/app/modules/risk/risk_engine.py) | Weighted scoring (Validation 35%, Tampering 40%, Face 25%) + hard overrides | `compute_risk()`, `RiskReport` |

#### New Module — Document Localization (Faster R-CNN)
| File | Path | Purpose |
|------|------|---------|
| **Detector** | [`backend/app/modules/localization/detector.py`](backend/app/modules/localization/detector.py) | Faster R-CNN region detection (photo, text fields, MRZ, stamp, signature) | `DocumentRegionDetector`, `RegionDetectionResult`, `DocumentRegion` |
| **Synthetic Generator** | [`backend/app/modules/localization/synthetic_generator.py`](backend/app/modules/localization/synthetic_generator.py) | Training data generator for all 5 document types | `SyntheticDocumentGenerator`, `SyntheticDocument`, `RegionAnnotation` |

### 3.2 API Routes

| Route File | Path | Endpoints |
|------------|------|-----------|
| **Documents** | [`backend/app/api/routes_documents.py`](backend/app/api/routes_documents.py) | `POST /scan`, `GET /scans`, `GET /scans/{id}`, `GET /stats` |
| **Face** | [`backend/app/api/routes_face.py`](backend/app/api/routes_face.py) | `POST /verify` (standalone face check) |
| **Health** | [`backend/app/api/routes_health.py`](backend/app/api/routes_health.py) | `GET /health` (engine status) |

### 3.3 Frontend Components

| Component | Path | Purpose |
|-----------|------|---------|
| **App Shell** | [`frontend/src/components/layout/AppShell.tsx`](frontend/src/components/layout/AppShell.tsx) | Layout wrapper with sidebar/topbar |
| **Pages** | [`frontend/src/pages/`](frontend/src/pages/) | LandingPage, ScanDashboard, ScanResult, AuditLog, NotFound |
| **UI Primitives** | [`frontend/src/components/ui/`](frontend/src/components/ui/) | Button, Card, Badge, Spinner |
| **Risk Components** | [`frontend/src/components/risk/`](frontend/src/components/risk/) | RiskGauge, ScoreBar, RiskBadge |
| **Upload Components** | [`frontend/src/components/upload/`](frontend/src/components/upload/) | DocumentDropzone, DocumentTypeSelect |
| **API Client** | [`frontend/src/lib/api.ts`](frontend/src/lib/api.ts) | Typed fetch client for all endpoints |
| **Types** | [`frontend/src/types/index.ts`](frontend/src/types/index.ts) | TypeScript mirrors of backend schemas |

---

## 4. Test Suite Reference

| Test File | Path | Coverage |
|-----------|------|----------|
| **MRZ Parser Tests** | [`backend/tests/test_mrz_parser.py`](backend/tests/test_mrz_parser.py) | ICAO checksum validation, tamper detection, false positive rejection, digit normalization |
| **Rules Engine Tests** | [`backend/tests/test_rules_engine.py`](backend/tests/test_rules_engine.py) | Passport validation, name mismatch, generic validation, issue/expiry logic |
| **Face Verifier Tests** | [`backend/tests/test_face_verifier.py`](backend/tests/test_face_verifier.py) | Synthetic face comparison, missing face handling |
| **API Integration Tests** | [`backend/tests/test_api.py`](backend/tests/test_api.py) | Health, scan+retrieve, face verify endpoints |
| **Live Test Script** | [`backend/tests/test_live.py`](backend/tests/test_live.py) | Manual end-to-end test with synthetic passport |

---

## 5. Key Research Papers & References

### 5.1 Document Analysis & OCR
1. **ICAO Doc 9303** — Machine Readable Travel Documents (Parts 1-7)
2. **Smith, R.** "An Overview of the Tesseract OCR Engine" (ICDAR 2007)
3. **PaddleOCR Team.** "PP-OCR: A Practical Ultra Lightweight OCR System" (arXiv 2020)
4. **Park, S. et al.** "Character Region Awareness for Text Detection (CRAFT)" (CVPR 2019)

### 5.2 Digital Forensics & Tampering Detection
5. **Krawetz, N.** "Digital Image Error Level Analysis" — FotoForensics.com
6. **Christlein, V. et al.** "An Evaluation of Popular Copy-Move Forgery Detection Approaches" (IEEE TIFS 2012)
7. **Fridrich, J. et al.** "Digital Image Forensics Using Sensor Pattern Noise" (IEEE TIFS 2006)
8. **Bappy, J.F. et al.** "Hybrid LSTM and Encoder-Decoder Architecture for Detection of Image Forgeries" (IEEE TIFS 2019)

### 5.3 Face Recognition & Verification
9. **Deng, J. et al.** "ArcFace: Additive Angular Margin Loss for Deep Face Recognition" (CVPR 2019)
10. **Schroff, F. et al.** "FaceNet: A Unified Embedding for Face Recognition and Clustering" (CVPR 2015)
11. **Guo, Y. et al.** "SCRFD: Sample and Computation Redistribution for Efficient Face Detection" (arXiv 2021)
12. **Liu, Y. et al.** "Deep Tree Learning for Zero-Shot Face Anti-Spoofing" (CVPR 2021)

### 5.4 Object Detection & Document Layout
13. **Ren, S. et al.** "Faster R-CNN: Towards Real-Time Object Detection with Region Proposal Networks" (NIPS 2015)
14. **Lin, T.Y. et al.** "Feature Pyramid Networks for Object Detection" (CVPR 2017)
15. **He, K. et al.** "Mask R-CNN" (ICCV 2017)
16. **Pfitzmann, J. et al.** "Figure and Table Detection in Document Images" (ICDAR 2022)

### 5.5 Blockchain & Audit Trail
17. **Androulaki, E. et al.** "Hyperledger Fabric: A Distributed Operating System for Permissioned Blockchains" (EuroSys 2018)
18. **Nakamoto, S.** "Bitcoin: A Peer-to-Peer Electronic Cash System" (2008) — hash-chain concept

---

## 6. External Libraries & Frameworks

### 6.1 Python Backend
| Library | Version | Purpose | Reference |
|---------|---------|---------|-----------|
| **FastAPI** | 0.115.0 | Web framework, async API | https://fastapi.tiangolo.com/ |
| **Uvicorn** | 0.30.6 | ASGI server | https://www.uvicorn.org/ |
| **Pydantic** | 2.9.2 | Data validation, settings | https://docs.pydantic.dev/ |
| **OpenCV** | 4.10.0 | Computer vision, image processing | https://opencv.org/ |
| **Pillow** | Latest | Image I/O, manipulation | https://python-pillow.org/ |
| **NumPy** | Latest | Numerical computing | https://numpy.org/ |
| **pytesseract** | 0.3.13 | Tesseract OCR wrapper | https://github.com/madmaze/pytesseract |
| **PaddleOCR** | (Optional) | Layout-aware OCR | https://github.com/PaddlePaddle/PaddleOCR |
| **torch/torchvision** | (For Faster R-CNN) | Deep learning, detection models | https://pytorch.org/ |
| **InsightFace** | 0.7.3 | Face detection/recognition (ArcFace) | https://github.com/deepinsight/insightface |
| **ONNX Runtime** | 1.19.2 | ONNX model inference | https://onnxruntime.ai/ |
| **Redis/RQ** | (Planned) | Async job queue | https://github.com/rq/rq |

### 6.2 Frontend
| Library | Version | Purpose | Reference |
|---------|---------|---------|-----------|
| **React** | 18.3.1 | UI framework | https://react.dev/ |
| **TypeScript** | 5.6.3 | Type safety | https://www.typescriptlang.org/ |
| **Vite** | 5.4.8 | Build tool | https://vitejs.dev/ |
| **Tailwind CSS** | 3.4.13 | Utility-first CSS | https://tailwindcss.com/ |
| **Framer Motion** | 11.11.9 | Animations | https://www.framer.com/motion/ |
| **React Router** | 6.26.2 | Routing | https://reactrouter.com/ |
| **Lucide React** | 0.451.0 | Icons | https://lucide.dev/ |

---

## 7. Datasets & Training Resources

### 7.1 Synthetic Data Generation
- **Generator:** [`backend/app/modules/localization/synthetic_generator.py`](backend/app/modules/localization/synthetic_generator.py)
- **Document Types:** Passport (TD3), Visa (TD1), National ID, Driving License, Permit
- **Output:** 900×600 RGB images + JSON annotations (class_name, bbox, text)
- **Region Classes:** 11 semantic classes (photo, name, surname, dob, doi, doe, doc_number, nationality, mrz, signature, stamp)

### 7.2 Real-World Data Sources (For Production)
| Dataset | Source | Use Case |
|---------|--------|----------|
| **MIDV-2020** | MIDV-2020: Mobile ID Document Video Dataset | Document classification, OCR |
| **IDDoc** | Various government portals | Real document template extraction |
| **Custom Collection** | SSB checkpoints | Domain-specific fine-tuning |

---

## 8. Cross-Reference Index

### By Module
| Module | Implementation | Tests | Docs |
|--------|----------------|-------|------|
| **Localization (NEW)** | `backend/app/modules/localization/` | — | This bibliography |
| **OCR** | `backend/app/modules/ocr/` | `test_mrz_parser.py` | ICAO 9303 |
| **Validation** | `backend/app/modules/validation/` | `test_rules_engine.py` | Problem Statement |
| **Tampering** | `backend/app/modules/tampering/` | — | ELA, ORB, EXIF papers |
| **Face** | `backend/app/modules/face/` | `test_face_verifier.py` | ArcFace, InsightFace |
| **Risk** | `backend/app/modules/risk/` | — | Architecture doc |
| **API** | `backend/app/api/` | `test_api.py` | API.md |
| **Frontend** | `frontend/src/` | — | Frontend README |

### By Document Type
| Doc Type | MRZ Format | Key Fields | Generator |
|----------|------------|------------|-----------|
| **Passport** | TD3 (2×44) | All 11 regions | ✅ |
| **Visa** | TD1 (3×30) | Photo, text, stamp, MRZ | ✅ |
| **National ID** | None (visual) | Photo, text fields | ✅ |
| **Driving License** | None (visual) | Photo, text, dates | ✅ |
| **Permit** | None (visual) | Photo, text, validity | ✅ |

---

## 9. Version History

| Date | Version | Changes |
|------|---------|---------|
| 2026-09-16 | 0.1.0 | Initial codebase audit, architecture documentation |
| 2026-09-16 | 0.2.0 | Document classifier training plan |
| 2026-09-16 | 0.3.0 | **Faster R-CNN localization module added** — detector, synthetic generator, region classes |

---

## 10. Quick Navigation Links

```
Project Root
├── README.md                                    ← START HERE
├── BIBLIOGRAPHY.md                              ← THIS FILE
├── docs/
│   ├── PROBLEM_STATEMENT.md                     ← Requirements
│   ├── ARCHITECTURE.md                          ← System design
│   ├── API.md                                   ← API contracts
│   └── plans/2026-09-16-document-classifier-training.md
├── pipeline imp recs/
│   ├── project_summary.md                       ← Target architecture
│   └── AI_Document_Screening_System_Architecture.pdf
├── backend/
│   ├── README.md                                ← Backend setup
│   ├── app/
│   │   ├── main.py                              ← FastAPI entry
│   │   ├── config.py                            ← Settings
│   │   ├── models/schemas.py                    ← API contracts
│   │   ├── api/                                 ← Routes
│   │   ├── modules/
│   │   │   ├── localization/                    ← NEW: Faster R-CNN
│   │   │   ├── ocr/                             ← Module 1
│   │   │   ├── validation/                      ← Module 2
│   │   │   ├── tampering/                       ← Module 3
│   │   │   ├── face/                            ← Module 4
│   │   │   └── risk/                            ← Module 5
│   │   └── storage/                             ← Audit trail
│   └── tests/                                   ← Pytest suite
├── frontend/
│   ├── README.md                                ← Frontend setup
│   ├── src/
│   │   ├── pages/                               ← Screens
│   │   ├── components/                          ← Reusable UI
│   │   ├── lib/api.ts                           ← API client
│   │   └── types/index.ts                       ← TS types
└── sample-data/                                 ← Demo images (gitignored)
```

---

*Generated for SIH 26188 — Pehchaan Project*  
*Last Updated: 2026-09-16*