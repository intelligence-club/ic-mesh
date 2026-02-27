#!/usr/bin/env python3
"""
IC Mesh PDF Text Extraction Handler

Extracts text and metadata from PDF files using multiple extraction methods:
- PyPDF2 for basic text extraction
- pdfplumber for advanced table/layout extraction  
- Fallback to OCR for image-based PDFs

Requirements:
  pip install PyPDF2 pdfplumber pillow

Usage:
  python handlers/pdf-extract.py input.pdf output.json
  
API:
  {
    "handler": "pdf-extract",
    "input": "document.pdf",
    "parameters": {
      "method": "auto|text|ocr|table",
      "pages": "1-5|all",
      "format": "text|json|markdown",
      "extract_tables": true,
      "extract_metadata": true,
      "ocr_fallback": true
    }
  }
"""

import sys
import json
import os
from pathlib import Path
import traceback
from datetime import datetime

# Check dependencies
def check_dependencies():
    """Check if required packages are installed."""
    missing = []
    
    try:
        import PyPDF2
    except ImportError:
        missing.append("PyPDF2")
    
    try:
        import pdfplumber
    except ImportError:
        missing.append("pdfplumber")
        
    try:
        import PIL
    except ImportError:
        missing.append("Pillow")
    
    return missing

class PDFExtractor:
    def __init__(self):
        self.supported_formats = ['pdf']
        
    def extract_text_pypdf2(self, pdf_path):
        """Extract text using PyPDF2 (fast, basic)."""
        import PyPDF2
        
        text_content = []
        metadata = {}
        
        try:
            with open(pdf_path, 'rb') as file:
                reader = PyPDF2.PdfReader(file)
                
                # Extract metadata
                if reader.metadata:
                    metadata.update({
                        'title': reader.metadata.get('/Title', ''),
                        'author': reader.metadata.get('/Author', ''),
                        'subject': reader.metadata.get('/Subject', ''),
                        'creator': reader.metadata.get('/Creator', ''),
                        'producer': reader.metadata.get('/Producer', ''),
                        'creation_date': str(reader.metadata.get('/CreationDate', '')),
                        'modification_date': str(reader.metadata.get('/ModDate', ''))
                    })
                
                metadata['page_count'] = len(reader.pages)
                
                # Extract text from each page
                for page_num, page in enumerate(reader.pages, 1):
                    try:
                        text = page.extract_text()
                        if text.strip():
                            text_content.append({
                                'page': page_num,
                                'text': text.strip(),
                                'word_count': len(text.split())
                            })
                    except Exception as e:
                        text_content.append({
                            'page': page_num,
                            'text': '',
                            'error': str(e),
                            'word_count': 0
                        })
        
        except Exception as e:
            raise Exception(f"PyPDF2 extraction failed: {str(e)}")
            
        return {
            'method': 'pypdf2',
            'pages': text_content,
            'metadata': metadata,
            'total_pages': len(text_content),
            'total_words': sum(p.get('word_count', 0) for p in text_content)
        }
    
    def extract_text_pdfplumber(self, pdf_path, extract_tables=True):
        """Extract text using pdfplumber (advanced, with tables)."""
        import pdfplumber
        
        text_content = []
        tables = []
        metadata = {}
        
        try:
            with pdfplumber.open(pdf_path) as pdf:
                metadata = {
                    'page_count': len(pdf.pages),
                    'metadata': pdf.metadata or {}
                }
                
                for page_num, page in enumerate(pdf.pages, 1):
                    page_data = {
                        'page': page_num,
                        'text': '',
                        'word_count': 0,
                        'tables': []
                    }
                    
                    try:
                        # Extract text
                        text = page.extract_text()
                        if text:
                            page_data['text'] = text.strip()
                            page_data['word_count'] = len(text.split())
                        
                        # Extract tables if requested
                        if extract_tables:
                            page_tables = page.extract_tables()
                            for table_num, table in enumerate(page_tables, 1):
                                if table:
                                    table_data = {
                                        'page': page_num,
                                        'table_id': f"page{page_num}_table{table_num}",
                                        'rows': len(table),
                                        'columns': len(table[0]) if table else 0,
                                        'data': table
                                    }
                                    page_data['tables'].append(table_data)
                                    tables.append(table_data)
                    
                    except Exception as e:
                        page_data['error'] = str(e)
                    
                    text_content.append(page_data)
        
        except Exception as e:
            raise Exception(f"pdfplumber extraction failed: {str(e)}")
            
        return {
            'method': 'pdfplumber',
            'pages': text_content,
            'tables': tables,
            'metadata': metadata,
            'total_pages': len(text_content),
            'total_words': sum(p.get('word_count', 0) for p in text_content),
            'total_tables': len(tables)
        }
    
    def extract_with_ocr_fallback(self, pdf_path):
        """Use OCR as fallback for image-based PDFs."""
        try:
            # First try regular text extraction
            result = self.extract_text_pdfplumber(pdf_path, extract_tables=False)
            
            # Check if we got meaningful text
            total_text = ' '.join(p.get('text', '') for p in result['pages'])
            if len(total_text.strip()) > 50:  # Arbitrary threshold
                return result
            
            # If minimal text, try OCR fallback
            print("Minimal text found, attempting OCR fallback...", file=sys.stderr)
            return self.ocr_fallback(pdf_path)
            
        except Exception as e:
            print(f"Regular extraction failed, attempting OCR: {e}", file=sys.stderr)
            return self.ocr_fallback(pdf_path)
    
    def ocr_fallback(self, pdf_path):
        """Convert PDF to images and OCR each page."""
        try:
            import fitz  # PyMuPDF
            
            doc = fitz.open(pdf_path)
            pages = []
            
            for page_num in range(doc.page_count):
                page = doc.load_page(page_num)
                
                # Convert to image
                mat = fitz.Matrix(2, 2)  # 2x zoom for better OCR
                pix = page.get_pixmap(matrix=mat)
                img_data = pix.tobytes("png")
                
                # Save temp image for OCR
                temp_img = f"/tmp/pdf_page_{page_num}.png"
                with open(temp_img, "wb") as f:
                    f.write(img_data)
                
                # OCR the image (call our OCR handler)
                try:
                    ocr_result = self.ocr_image(temp_img)
                    pages.append({
                        'page': page_num + 1,
                        'text': ocr_result.get('text', ''),
                        'word_count': len(ocr_result.get('text', '').split()),
                        'confidence': ocr_result.get('confidence', 0),
                        'method': 'ocr_fallback'
                    })
                except Exception as ocr_error:
                    pages.append({
                        'page': page_num + 1,
                        'text': '',
                        'word_count': 0,
                        'error': str(ocr_error),
                        'method': 'ocr_fallback'
                    })
                finally:
                    # Clean up temp file
                    if os.path.exists(temp_img):
                        os.remove(temp_img)
            
            doc.close()
            
            return {
                'method': 'ocr_fallback',
                'pages': pages,
                'total_pages': len(pages),
                'total_words': sum(p.get('word_count', 0) for p in pages),
                'note': 'Used OCR fallback due to image-based PDF'
            }
            
        except ImportError:
            return {
                'method': 'ocr_fallback_failed',
                'error': 'PyMuPDF not available for OCR fallback',
                'pages': [],
                'total_pages': 0,
                'total_words': 0
            }
        except Exception as e:
            return {
                'method': 'ocr_fallback_failed',
                'error': str(e),
                'pages': [],
                'total_pages': 0, 
                'total_words': 0
            }
    
    def ocr_image(self, image_path):
        """OCR a single image using tesseract."""
        try:
            import subprocess
            result = subprocess.run([
                'tesseract', image_path, 'stdout', '--psm', '3'
            ], capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0:
                return {
                    'text': result.stdout.strip(),
                    'confidence': 85  # Estimated confidence
                }
            else:
                return {'text': '', 'confidence': 0, 'error': result.stderr}
                
        except Exception as e:
            return {'text': '', 'confidence': 0, 'error': str(e)}
    
    def format_output(self, extraction_result, format_type='json'):
        """Format the extraction result according to requested format."""
        
        if format_type == 'text':
            # Plain text output
            pages_text = []
            for page in extraction_result['pages']:
                if page.get('text'):
                    pages_text.append(f"=== Page {page['page']} ===\n{page['text']}")
            return '\n\n'.join(pages_text)
        
        elif format_type == 'markdown':
            # Markdown formatted output
            md_content = [f"# PDF Text Extraction\n"]
            md_content.append(f"**Method:** {extraction_result['method']}")
            md_content.append(f"**Total Pages:** {extraction_result['total_pages']}")
            md_content.append(f"**Total Words:** {extraction_result['total_words']}")
            
            if 'total_tables' in extraction_result:
                md_content.append(f"**Total Tables:** {extraction_result['total_tables']}")
            
            md_content.append("\n---\n")
            
            for page in extraction_result['pages']:
                md_content.append(f"## Page {page['page']}")
                if page.get('text'):
                    md_content.append(page['text'])
                
                # Add tables in markdown format
                if page.get('tables'):
                    for table in page['tables']:
                        md_content.append(f"\n### Table {table['table_id']}")
                        if table['data']:
                            # Convert table to markdown
                            header = table['data'][0]
                            rows = table['data'][1:]
                            
                            # Header row
                            md_content.append('| ' + ' | '.join(str(cell or '') for cell in header) + ' |')
                            # Separator
                            md_content.append('|' + '---|' * len(header))
                            # Data rows
                            for row in rows:
                                md_content.append('| ' + ' | '.join(str(cell or '') for cell in row) + ' |')
                
                md_content.append("")
            
            return '\n'.join(md_content)
        
        else:
            # JSON output (default)
            return extraction_result
    
    def extract(self, pdf_path, parameters=None):
        """Main extraction method."""
        if not parameters:
            parameters = {}
        
        method = parameters.get('method', 'auto')
        pages_param = parameters.get('pages', 'all')
        format_type = parameters.get('format', 'json')
        extract_tables = parameters.get('extract_tables', True)
        extract_metadata = parameters.get('extract_metadata', True)
        ocr_fallback = parameters.get('ocr_fallback', True)
        
        # Validate file exists and is PDF
        if not os.path.exists(pdf_path):
            raise FileNotFoundError(f"PDF file not found: {pdf_path}")
        
        if not pdf_path.lower().endswith('.pdf'):
            raise ValueError("Input file must be a PDF")
        
        # Choose extraction method
        try:
            if method == 'text' or method == 'pypdf2':
                result = self.extract_text_pypdf2(pdf_path)
            elif method == 'table' or method == 'pdfplumber':
                result = self.extract_text_pdfplumber(pdf_path, extract_tables)
            elif method == 'ocr':
                result = self.ocr_fallback(pdf_path)
            else:  # auto
                if ocr_fallback:
                    result = self.extract_with_ocr_fallback(pdf_path)
                else:
                    result = self.extract_text_pdfplumber(pdf_path, extract_tables)
        
        except Exception as e:
            # If all else fails, try basic extraction
            try:
                result = self.extract_text_pypdf2(pdf_path)
                result['fallback_used'] = True
                result['original_error'] = str(e)
            except Exception as final_error:
                result = {
                    'method': 'failed',
                    'error': str(final_error),
                    'original_error': str(e),
                    'pages': [],
                    'total_pages': 0,
                    'total_words': 0
                }
        
        # Add extraction metadata
        result['extraction_info'] = {
            'timestamp': datetime.utcnow().isoformat(),
            'file_size': os.path.getsize(pdf_path),
            'parameters': parameters,
            'handler_version': '1.0.0'
        }
        
        # Filter pages if specified
        if pages_param != 'all' and '-' in pages_param:
            try:
                start_page, end_page = map(int, pages_param.split('-'))
                if 'pages' in result:
                    result['pages'] = [p for p in result['pages'] 
                                     if start_page <= p['page'] <= end_page]
                    result['filtered_pages'] = f"{start_page}-{end_page}"
            except ValueError:
                result['page_filter_error'] = f"Invalid page range: {pages_param}"
        
        # Format output
        if format_type != 'json':
            return self.format_output(result, format_type)
        
        return result

def main():
    if len(sys.argv) < 3:
        print("Usage: python pdf-extract.py <input.pdf> <output.json> [parameters_json]")
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_file = sys.argv[2]
    parameters = {}
    
    # Parse parameters if provided
    if len(sys.argv) > 3:
        try:
            parameters = json.loads(sys.argv[3])
        except json.JSONDecodeError as e:
            print(f"Error parsing parameters: {e}", file=sys.stderr)
            sys.exit(1)
    
    # Check dependencies
    missing_deps = check_dependencies()
    if missing_deps:
        error_result = {
            "error": f"Missing required packages: {', '.join(missing_deps)}",
            "install_command": f"pip install {' '.join(missing_deps)}",
            "success": False
        }
        
        with open(output_file, 'w') as f:
            json.dump(error_result, f, indent=2)
        sys.exit(1)
    
    try:
        extractor = PDFExtractor()
        result = extractor.extract(input_file, parameters)
        
        # Handle different output formats
        if parameters.get('format') == 'text':
            # Write plain text
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(result)
        elif parameters.get('format') == 'markdown':
            # Write markdown
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(result)
        else:
            # Write JSON (default)
            success_result = {
                "success": True,
                "result": result,
                "processing_time": "N/A"  # Could add timing
            }
            
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(success_result, f, indent=2, ensure_ascii=False)
        
        print(f"PDF extraction completed successfully", file=sys.stderr)
        
    except Exception as e:
        error_result = {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc()
        }
        
        with open(output_file, 'w') as f:
            json.dump(error_result, f, indent=2)
        
        print(f"PDF extraction failed: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()