# PDF Text Extraction Handler

Advanced PDF text and metadata extraction handler for the IC Mesh network.

## Overview

The PDF extraction handler provides comprehensive text extraction from PDF documents using multiple methods and techniques. It automatically selects the best extraction method based on the PDF content type and provides fallback mechanisms for image-based PDFs.

## Features

- **Multiple extraction methods**: PyPDF2, pdfplumber, OCR fallback
- **Automatic method selection**: Chooses optimal extraction approach
- **Table extraction**: Advanced table detection and extraction
- **Metadata extraction**: PDF metadata and document properties
- **Multiple output formats**: JSON, plain text, Markdown
- **OCR fallback**: Handles image-based PDFs using Tesseract
- **Page range selection**: Extract specific page ranges
- **Comprehensive error handling**: Graceful degradation on failures

## Installation

### Required Dependencies

```bash
# Core PDF processing
pip install PyPDF2 pdfplumber

# Image handling (required for OCR fallback)
pip install Pillow

# Optional: Enhanced image-based PDF support
pip install PyMuPDF  # For better OCR conversion

# Optional: Better OCR support
sudo apt-get install tesseract-ocr
```

### Verify Installation

```bash
python3 handlers/pdf-extract.py --help
```

## Usage

### Command Line

```bash
# Basic extraction
python3 handlers/pdf-extract.py input.pdf output.json

# With parameters
python3 handlers/pdf-extract.py input.pdf output.json '{"method": "auto", "format": "markdown"}'
```

### IC Mesh API

```javascript
// Submit PDF extraction job
const job = {
  handler: "pdf-extract",
  input: "document.pdf",
  parameters: {
    method: "auto",
    format: "json",
    extract_tables: true,
    extract_metadata: true,
    ocr_fallback: true
  }
};

const response = await fetch('/jobs/submit', {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-api-key'
  },
  body: JSON.stringify(job)
});
```

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `method` | string | `"auto"` | Extraction method: `auto`, `text`, `table`, `ocr` |
| `format` | string | `"json"` | Output format: `json`, `text`, `markdown` |
| `pages` | string | `"all"` | Page range: `all`, `1-5`, specific range |
| `extract_tables` | boolean | `true` | Extract tables when using pdfplumber |
| `extract_metadata` | boolean | `true` | Include PDF metadata in output |
| `ocr_fallback` | boolean | `true` | Use OCR for image-based PDFs |

### Extraction Methods

#### `auto` (Recommended)
Automatically selects the best method:
1. Tries pdfplumber for advanced extraction
2. Falls back to OCR if minimal text found
3. Uses PyPDF2 as final fallback

#### `text` or `pypdf2`
Fast basic text extraction using PyPDF2:
- Fastest method
- Good for text-based PDFs
- No table extraction
- Basic metadata only

#### `table` or `pdfplumber`
Advanced extraction with table support:
- Slower but more comprehensive
- Detects and extracts tables
- Better text layout preservation
- Full metadata extraction

#### `ocr`
OCR-based extraction for image PDFs:
- Converts PDF pages to images
- Uses Tesseract OCR
- Slowest but handles scanned documents
- Requires additional dependencies

## Output Formats

### JSON Format (Default)

```json
{
  "success": true,
  "result": {
    "method": "pdfplumber",
    "pages": [
      {
        "page": 1,
        "text": "Extracted text content...",
        "word_count": 245,
        "tables": [
          {
            "page": 1,
            "table_id": "page1_table1",
            "rows": 5,
            "columns": 3,
            "data": [
              ["Header 1", "Header 2", "Header 3"],
              ["Row 1 Col 1", "Row 1 Col 2", "Row 1 Col 3"]
            ]
          }
        ]
      }
    ],
    "metadata": {
      "title": "Document Title",
      "author": "Author Name",
      "page_count": 10,
      "creation_date": "2023-01-15T10:30:00"
    },
    "total_pages": 10,
    "total_words": 2450,
    "total_tables": 3,
    "extraction_info": {
      "timestamp": "2026-02-25T06:30:00.000Z",
      "file_size": 1048576,
      "parameters": {...},
      "handler_version": "1.0.0"
    }
  }
}
```

### Text Format

```
=== Page 1 ===
Extracted text content from page 1...

=== Page 2 ===
Extracted text content from page 2...
```

### Markdown Format

```markdown
# PDF Text Extraction

**Method:** pdfplumber
**Total Pages:** 10
**Total Words:** 2450
**Total Tables:** 3

---

## Page 1

Extracted text content from page 1...

### Table page1_table1

| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Data 1   | Data 2   | Data 3   |
```

## Error Handling

The handler provides comprehensive error handling with graceful degradation:

### Common Error Scenarios

#### Missing Dependencies
```json
{
  "success": false,
  "error": "Missing required packages: PyPDF2, pdfplumber",
  "install_command": "pip install PyPDF2 pdfplumber"
}
```

#### Invalid PDF File
```json
{
  "success": false,
  "error": "Input file must be a PDF",
  "file_received": "document.txt"
}
```

#### Extraction Failure with Fallback
```json
{
  "success": true,
  "result": {
    "method": "pypdf2",
    "fallback_used": true,
    "original_error": "pdfplumber extraction failed: ...",
    "pages": [...]
  }
}
```

## Performance Characteristics

| Method | Speed | Quality | Memory Usage | Use Case |
|--------|-------|---------|--------------|----------|
| PyPDF2 | Fast | Good | Low | Simple text PDFs |
| pdfplumber | Medium | Excellent | Medium | Complex layouts, tables |
| OCR | Slow | Good* | High | Scanned/image PDFs |

*OCR quality depends on image clarity and Tesseract configuration

### Optimization Tips

1. **Choose appropriate method**: Use `text` for simple PDFs, `auto` for mixed content
2. **Limit page ranges**: Process only needed pages with `pages` parameter
3. **Disable table extraction**: Set `extract_tables: false` for text-only needs
4. **Batch processing**: Process multiple PDFs in parallel for better throughput

## Integration Examples

### Node.js Integration

```javascript
const { exec } = require('child_process');
const fs = require('fs');

async function extractPDF(pdfPath, options = {}) {
  return new Promise((resolve, reject) => {
    const outputPath = `/tmp/pdf-output-${Date.now()}.json`;
    const params = JSON.stringify(options);
    const command = `python3 handlers/pdf-extract.py "${pdfPath}" "${outputPath}" '${params}'`;
    
    exec(command, (error, stdout, stderr) => {
      if (fs.existsSync(outputPath)) {
        const result = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        fs.unlinkSync(outputPath); // Clean up
        
        if (result.success) {
          resolve(result.result);
        } else {
          reject(new Error(result.error));
        }
      } else {
        reject(error || new Error('No output generated'));
      }
    });
  });
}

// Usage
try {
  const result = await extractPDF('document.pdf', {
    method: 'auto',
    extract_tables: true,
    format: 'json'
  });
  
  console.log(`Extracted ${result.total_words} words from ${result.total_pages} pages`);
  console.log(`Found ${result.total_tables} tables`);
} catch (error) {
  console.error('PDF extraction failed:', error.message);
}
```

### Python Integration

```python
import json
import subprocess
import tempfile

def extract_pdf(pdf_path, parameters=None):
    """Extract text from PDF using IC Mesh handler."""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        output_path = f.name
    
    cmd = ['python3', 'handlers/pdf-extract.py', pdf_path, output_path]
    if parameters:
        cmd.append(json.dumps(parameters))
    
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        
        with open(output_path, 'r') as f:
            result = json.load(f)
        
        if result['success']:
            return result['result']
        else:
            raise Exception(result['error'])
    
    finally:
        if os.path.exists(output_path):
            os.unlink(output_path)

# Usage
try:
    result = extract_pdf('document.pdf', {
        'method': 'auto',
        'extract_tables': True
    })
    
    for page in result['pages']:
        print(f"Page {page['page']}: {page['word_count']} words")
        
except Exception as e:
    print(f"Extraction failed: {e}")
```

## Testing

Run the comprehensive test suite:

```bash
# Run all tests
node scripts/test-pdf-handler.js

# Add to main test suite
npm test
```

The test suite covers:
- Handler availability and permissions
- Dependency checking
- Parameter validation
- Error handling scenarios
- Output format generation
- IC Mesh integration compatibility

## Troubleshooting

### Installation Issues

```bash
# Install missing dependencies
pip install PyPDF2 pdfplumber Pillow

# For OCR support
sudo apt-get install tesseract-ocr
sudo apt-get install tesseract-ocr-eng  # English language pack

# Additional language packs
sudo apt-get install tesseract-ocr-fra  # French
sudo apt-get install tesseract-ocr-deu  # German
```

### Common Problems

#### "No module named PyPDF2"
```bash
pip3 install PyPDF2
# or
python3 -m pip install PyPDF2
```

#### OCR Fallback Not Working
```bash
# Check Tesseract installation
tesseract --version

# Install if missing
sudo apt-get install tesseract-ocr

# Check Python OCR integration
python3 -c "import subprocess; print(subprocess.run(['tesseract', '--version'], capture_output=True).stdout.decode())"
```

#### Memory Issues with Large PDFs
```bash
# Process in chunks or use streaming
python3 handlers/pdf-extract.py large.pdf output.json '{"pages": "1-10"}'

# Monitor memory usage
top -p $(pgrep python3)
```

#### Slow Processing
- Use `method: "text"` for simple PDFs
- Set `extract_tables: false` if tables not needed
- Process specific page ranges only
- Consider splitting large PDFs

## Configuration

### Node Configuration Example

```json
{
  "nodeId": "pdf-processor-node",
  "capabilities": ["pdf-extract"],
  "handlers": {
    "pdf-extract": {
      "path": "./handlers/pdf-extract.py",
      "timeout": 300000,
      "memory_limit": "2GB",
      "dependencies": ["PyPDF2", "pdfplumber", "Pillow"]
    }
  },
  "webhook": "http://localhost:3000/webhook"
}
```

### Environment Variables

```bash
# Optional: Set OCR language
export TESSERACT_LANG="eng+fra+deu"

# Optional: Temporary directory for large files
export TEMP_DIR="/tmp/pdf-processing"

# Optional: Memory limit for large PDFs
export PYTHON_MEMORY_LIMIT="2GB"
```

## API Reference

### Handler Interface

```python
class PDFExtractor:
    def extract(self, pdf_path, parameters=None):
        """
        Main extraction method.
        
        Args:
            pdf_path (str): Path to PDF file
            parameters (dict): Extraction parameters
            
        Returns:
            dict: Extraction result or formatted output
        """
```

### Parameter Validation

The handler validates all parameters and provides helpful error messages:

- `method`: Must be one of `auto`, `text`, `table`, `ocr`
- `format`: Must be one of `json`, `text`, `markdown`
- `pages`: Must be `all` or range like `1-5`
- Boolean parameters: Converted automatically

## Contributing

To extend the PDF handler:

1. **Add new extraction methods**: Extend `PDFExtractor` class
2. **Support new formats**: Add format handlers to `format_output()`
3. **Improve OCR**: Enhance `ocr_fallback()` method
4. **Add tests**: Update test suite for new features

## Pricing

When deployed in IC Mesh network:

| Document Size | Estimated Cost | Processing Time |
|---------------|---------------|-----------------|
| < 1MB | 1-2 ints | 5-15 seconds |
| 1-5MB | 2-5 ints | 15-45 seconds |
| 5-20MB | 5-15 ints | 1-3 minutes |
| > 20MB | 15+ ints | 3+ minutes |

*Costs vary based on complexity and extraction method used*

---

*For support, see [Troubleshooting Guide](../TROUBLESHOOTING.md) or contact [hello@moilol.com](mailto:hello@moilol.com)*