#!/usr/bin/env python3
"""
IC Mesh OCR Handler - Optical Character Recognition via Tesseract
Extracts text from images and documents with configurable language support.
"""

import json
import sys
import os
import subprocess
import tempfile
from pathlib import Path
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def check_tesseract():
    """Check if Tesseract is installed and available"""
    try:
        result = subprocess.run(['tesseract', '--version'], 
                               capture_output=True, text=True, timeout=5)
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False

def get_available_languages():
    """Get list of available Tesseract languages"""
    try:
        result = subprocess.run(['tesseract', '--list-langs'], 
                               capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')[1:]  # Skip header
            return [lang.strip() for lang in lines if lang.strip()]
        return ['eng']  # Default fallback
    except:
        return ['eng']

def preprocess_image(input_path, work_dir):
    """Preprocess image for better OCR results using ImageMagick if available"""
    try:
        # Check if ImageMagick is available
        subprocess.run(['convert', '--version'], 
                      capture_output=True, timeout=5)
        
        output_path = os.path.join(work_dir, 'preprocessed.png')
        
        # Basic preprocessing: normalize, denoise, enhance contrast
        cmd = [
            'convert', input_path,
            '-density', '300',
            '-colorspace', 'Gray',
            '-normalize',
            '-enhance',
            '-sharpen', '0x1',
            output_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, timeout=30)
        
        if result.returncode == 0:
            logger.info("Image preprocessed successfully")
            return output_path
        else:
            logger.warning("Preprocessing failed, using original")
            return input_path
            
    except (FileNotFoundError, subprocess.TimeoutExpired):
        logger.info("ImageMagick not available, skipping preprocessing")
        return input_path

def run_ocr(image_path, language, output_format, work_dir):
    """Run Tesseract OCR on the image"""
    output_base = os.path.join(work_dir, 'ocr_output')
    
    # Build Tesseract command
    cmd = ['tesseract', image_path, output_base, '-l', language]
    
    # Configure output format
    if output_format == 'hocr':
        cmd.extend(['-c', 'tessedit_create_hocr=1'])
    elif output_format == 'pdf':
        cmd.extend(['-c', 'tessedit_create_pdf=1'])
    elif output_format == 'tsv':
        cmd.extend(['-c', 'tessedit_create_tsv=1'])
    # Default is txt
    
    try:
        # Run Tesseract with timeout
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        
        if result.returncode != 0:
            return None, f"Tesseract failed: {result.stderr}"
        
        # Read the output file
        output_file = f"{output_base}.txt"
        if output_format == 'hocr':
            output_file = f"{output_base}.hocr"
        elif output_format == 'pdf':
            output_file = f"{output_base}.pdf"
        elif output_format == 'tsv':
            output_file = f"{output_base}.tsv"
        
        if os.path.exists(output_file):
            if output_format == 'pdf':
                # For PDF, just return the path since it's binary
                return output_file, None
            else:
                with open(output_file, 'r', encoding='utf-8') as f:
                    content = f.read()
                return content, None
        else:
            return None, "No output file generated"
            
    except subprocess.TimeoutExpired:
        return None, "OCR operation timed out"
    except Exception as e:
        return None, f"OCR error: {str(e)}"

def extract_confidence_stats(tsv_content):
    """Extract confidence statistics from TSV output"""
    if not tsv_content:
        return {}
    
    lines = tsv_content.strip().split('\n')
    if len(lines) < 2:  # Header + at least one data line
        return {}
    
    confidences = []
    word_count = 0
    
    for line in lines[1:]:  # Skip header
        parts = line.split('\t')
        if len(parts) >= 11:  # TSV format has 12 columns
            try:
                conf = int(parts[10])  # Confidence is in column 10
                text = parts[11].strip()  # Text is in column 11
                if conf >= 0 and text:  # Valid confidence and non-empty text
                    confidences.append(conf)
                    word_count += 1
            except (ValueError, IndexError):
                continue
    
    if not confidences:
        return {"word_count": 0, "avg_confidence": 0}
    
    return {
        "word_count": word_count,
        "avg_confidence": sum(confidences) / len(confidences),
        "min_confidence": min(confidences),
        "max_confidence": max(confidences)
    }

def main():
    """Main OCR handler function"""
    try:
        # Read job from stdin
        job_input = sys.stdin.read()
        job = json.loads(job_input)
        
        payload = job.get("payload", {})
        work_dir = job.get("workDir", "/tmp")
        input_files = job.get("inputFiles", [])
        
        # Validate Tesseract is available
        if not check_tesseract():
            print(json.dumps({
                "success": False,
                "error": "Tesseract OCR is not installed or not available in PATH"
            }))
            return
        
        # Validate input
        if not input_files:
            print(json.dumps({
                "success": False,
                "error": "No input file provided"
            }))
            return
        
        image_path = input_files[0]
        if not os.path.exists(image_path):
            print(json.dumps({
                "success": False,
                "error": f"Input file not found: {image_path}"
            }))
            return
        
        # Extract parameters
        language = payload.get("language", "eng")
        output_format = payload.get("format", "txt")  # txt, hocr, pdf, tsv
        preprocess = payload.get("preprocess", True)
        include_confidence = payload.get("confidence", False)
        
        # Validate language
        available_langs = get_available_languages()
        if language not in available_langs:
            print(json.dumps({
                "success": False,
                "error": f"Language '{language}' not available. Available: {', '.join(available_langs[:10])}"
            }))
            return
        
        # Create output directory
        output_dir = os.path.join(work_dir, "output")
        os.makedirs(output_dir, exist_ok=True)
        
        # Preprocess image if requested and ImageMagick is available
        processed_image = image_path
        if preprocess:
            processed_image = preprocess_image(image_path, work_dir)
        
        # Run OCR
        ocr_result, error = run_ocr(processed_image, language, output_format, work_dir)
        
        if error:
            print(json.dumps({
                "success": False,
                "error": error
            }))
            return
        
        # Prepare response
        response_data = {
            "language": language,
            "format": output_format,
            "file_size": os.path.getsize(image_path),
            "preprocessed": preprocess and processed_image != image_path
        }
        
        output_files = []
        
        if output_format == 'pdf':
            # Copy PDF to output directory
            pdf_output = os.path.join(output_dir, "ocr_result.pdf")
            import shutil
            shutil.copy2(ocr_result, pdf_output)
            output_files.append(pdf_output)
            response_data["output_file"] = "ocr_result.pdf"
        else:
            # Text-based formats
            response_data["text"] = ocr_result
            response_data["character_count"] = len(ocr_result) if ocr_result else 0
            
            # Save text output
            text_output = os.path.join(output_dir, f"ocr_result.{output_format}")
            with open(text_output, 'w', encoding='utf-8') as f:
                f.write(ocr_result)
            output_files.append(text_output)
        
        # Get confidence statistics if requested
        if include_confidence and output_format != 'pdf':
            # Run additional TSV extraction for confidence
            tsv_result, _ = run_ocr(processed_image, language, 'tsv', work_dir)
            if tsv_result:
                stats = extract_confidence_stats(tsv_result)
                response_data["confidence_stats"] = stats
        
        print(json.dumps({
            "success": True,
            "data": response_data,
            "outputFiles": output_files
        }))
        
    except json.JSONDecodeError as e:
        print(json.dumps({
            "success": False,
            "error": f"Invalid JSON input: {str(e)}"
        }))
    except Exception as e:
        logger.exception("Unexpected error in OCR handler")
        print(json.dumps({
            "success": False,
            "error": f"Internal error: {str(e)}"
        }))

if __name__ == "__main__":
    main()