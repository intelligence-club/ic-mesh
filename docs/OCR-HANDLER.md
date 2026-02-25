# OCR Handler — Optical Character Recognition

Extract text from images and documents using Tesseract OCR engine.

## Features

- **Multi-language support** — 100+ languages via Tesseract language packs
- **Multiple output formats** — Plain text, HOCR, PDF, TSV with coordinates
- **Image preprocessing** — Automatic enhancement via ImageMagick (optional)
- **Confidence scoring** — Word-level confidence statistics
- **Robust error handling** — Graceful degradation when dependencies are missing
- **Flexible configuration** — Extensive parameter support

## Requirements

### Required
- **Python 3.6+** — Handler runtime
- **Tesseract 4.0+** — OCR engine

### Optional (but recommended)
- **ImageMagick** — For image preprocessing and enhancement
- **Additional language packs** — For non-English text recognition

### Installation

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install tesseract-ocr tesseract-ocr-eng imagemagick python3
# Additional languages (examples):
sudo apt install tesseract-ocr-spa tesseract-ocr-fra tesseract-ocr-deu
```

**macOS (Homebrew):**
```bash
brew install tesseract imagemagick python3
# Additional languages:
brew install tesseract-lang
```

**Verify installation:**
```bash
tesseract --version
tesseract --list-langs
```

## Configuration

Add to your `node-config.json`:

```json
{
  "handlers": {
    "ocr": {
      "command": "python3 handlers/ocr.py",
      "description": "Optical Character Recognition via Tesseract",
      "accepts": {
        "mimeTypes": ["image/*", "application/pdf"],
        "maxInputSizeMB": 25
      },
      "resources": {
        "timeout": 120,
        "maxConcurrent": 3,
        "cpuWeight": "medium",
        "requiresGPU": false
      },
      "env": {
        "TESSDATA_PREFIX": "/usr/share/tesseract-ocr/5/tessdata"
      }
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TESSDATA_PREFIX` | auto-detect | Path to Tesseract language data |
| `MAGICK_MEMORY_LIMIT` | system default | ImageMagick memory limit |
| `MAGICK_DISK_LIMIT` | system default | ImageMagick disk usage limit |

## Usage

### Basic Text Extraction

```bash
curl -X POST https://moilol.com/mesh/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "ocr",
    "payload": {
      "url": "https://example.com/document.png",
      "language": "eng"
    },
    "requirements": {"capability": "ocr"}
  }'
```

### Multi-language Document

```bash
curl -X POST https://moilol.com/mesh/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "ocr",
    "payload": {
      "url": "https://example.com/spanish-document.jpg",
      "language": "spa",
      "format": "hocr",
      "preprocess": true,
      "confidence": true
    },
    "requirements": {"capability": "ocr"}
  }'
```

### PDF Output (Searchable PDF)

```bash
curl -X POST https://moilol.com/mesh/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "ocr",
    "payload": {
      "url": "https://example.com/scan.png",
      "format": "pdf",
      "language": "eng"
    },
    "requirements": {"capability": "ocr"}
  }'
```

## Parameters

### Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `language` | string | `"eng"` | Tesseract language code (see supported languages) |
| `format` | string | `"txt"` | Output format: `txt`, `hocr`, `pdf`, `tsv` |
| `preprocess` | boolean | `true` | Apply image enhancement preprocessing |
| `confidence` | boolean | `false` | Include word-level confidence statistics |

### Supported Languages

Common language codes (use `tesseract --list-langs` for full list):

| Code | Language | Code | Language |
|------|----------|------|----------|
| `eng` | English | `spa` | Spanish |
| `fra` | French | `deu` | German |
| `ita` | Italian | `por` | Portuguese |
| `rus` | Russian | `ara` | Arabic |
| `chi_sim` | Chinese Simplified | `jpn` | Japanese |
| `kor` | Korean | `hin` | Hindi |

### Output Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| `txt` | `.txt` | Plain text output |
| `hocr` | `.hocr` | HTML with position coordinates |
| `pdf` | `.pdf` | Searchable PDF overlay |
| `tsv` | `.tsv` | Tab-separated values with coordinates and confidence |

## Response Format

### Success Response

```json
{
  "success": true,
  "data": {
    "text": "Extracted text content...",
    "language": "eng",
    "format": "txt",
    "character_count": 1234,
    "file_size": 567890,
    "preprocessed": true,
    "confidence_stats": {
      "word_count": 89,
      "avg_confidence": 87.3,
      "min_confidence": 45,
      "max_confidence": 100
    }
  },
  "outputFiles": ["/path/to/ocr_result.txt"]
}
```

### Error Response

```json
{
  "success": false,
  "error": "Language 'xyz' not available. Available: eng, spa, fra..."
}
```

## Performance Guidelines

### Image Optimization

For best OCR results:
- **Resolution**: 300 DPI or higher
- **Format**: PNG or TIFF preferred over JPEG
- **Size**: Under 25MB (configurable)
- **Content**: High contrast, clean text

### Processing Times

Typical processing times on modern hardware:

| Image Size | Language | Preprocessing | Time |
|------------|----------|--------------|------|
| 1MB | English | Yes | 5-15s |
| 5MB | English | Yes | 15-30s |
| 1MB | Multi-language | Yes | 10-20s |
| 10MB+ | Any | Yes | 30s-2min |

### Resource Usage

- **CPU**: Medium intensity (configurable weight)
- **Memory**: 100-500MB per job (depends on image size)
- **Disk**: Temporary files cleaned automatically
- **Network**: Only for input/output file transfer

## Advanced Configuration

### Custom Preprocessing Pipeline

For specialized documents, you can disable built-in preprocessing and provide custom ImageMagick commands via environment variables:

```json
{
  "env": {
    "CUSTOM_PREPROCESS": "convert INPUT -density 300 -colorspace Gray -normalize -enhance OUTPUT"
  }
}
```

### Language Combination

Some documents benefit from multiple language detection:

```json
{
  "payload": {
    "language": "eng+spa+fra",
    "format": "tsv"
  }
}
```

### Performance Tuning

For high-volume processing:

```json
{
  "resources": {
    "maxConcurrent": 5,
    "timeout": 300,
    "cpuWeight": "high"
  },
  "payload": {
    "preprocess": false
  }
}
```

## Troubleshooting

### Common Issues

**"Tesseract not found"**
- Install Tesseract: `sudo apt install tesseract-ocr`
- Check PATH: `which tesseract`

**"Language not available"**
- List available: `tesseract --list-langs`
- Install language pack: `sudo apt install tesseract-ocr-[lang]`

**Poor OCR accuracy**
- Enable preprocessing: `"preprocess": true`
- Use higher resolution images (300+ DPI)
- Ensure good contrast and clean text

**Timeout errors**
- Increase timeout in handler config
- Reduce image size or disable preprocessing for speed
- Consider splitting large documents

### Performance Optimization

1. **Image preprocessing off** for speed: `"preprocess": false`
2. **Batch processing** multiple images in sequence
3. **Language-specific models** for better accuracy
4. **Resource limits** to prevent system overload

## Development

### Testing

Run the OCR handler test suite:

```bash
node scripts/test-ocr-handler.js
```

### Custom Handlers

The OCR handler can serve as a template for other document processing handlers:
- PDF text extraction
- Barcode/QR code recognition
- Document classification
- Form data extraction

---

**Handler Version**: v1.0  
**Last Updated**: February 2026  
**Tesseract Version**: 5.x supported