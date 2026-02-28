// Agricultural Services API Routes for IC Mesh
// Handles soil analysis, weather integration, and farmer-facing services
// Built on existing mesh infrastructure

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const SoilAnalysisCapability = require('../capabilities/soil-analysis');

// Initialize soil analysis capability
const soilAnalysis = new SoilAnalysisCapability();
let soilAnalysisReady = false;

// Initialize on startup
(async () => {
  soilAnalysisReady = await soilAnalysis.initialize();
})();

// Configure multer for image uploads
const upload = multer({
  dest: 'uploads/soil-images/',
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic'];
    cb(null, allowedTypes.includes(file.mimetype));
  }
});

// Farmer-facing endpoints

/**
 * GET /agricultural/capabilities
 * Returns available agricultural services and their specifications
 */
router.get('/capabilities', (req, res) => {
  res.json({
    services: {
      soil_analysis: soilAnalysisReady ? soilAnalysis.getCapabilityInfo() : null,
      weather_alerts: {
        name: 'weather-alerts',
        description: 'Hyperlocal weather predictions for agricultural decision making',
        status: 'planned',
        timeline: 'Q2 2026'
      },
      indigenous_knowledge: {
        name: 'knowledge-preservation',
        description: 'Community database of traditional farming practices',
        status: 'research',
        timeline: 'Q3 2026'
      }
    },
    pricing: {
      soil_analysis_complete: '$5.00',
      soil_analysis_quick: '$2.00',
      weather_alerts_monthly: '$10.00',
      knowledge_access: 'free'
    },
    supported_regions: ['Pacific Northwest', 'California Central Valley'],
    contact: 'farmers@moilol.com'
  });
});

/**
 * POST /agricultural/soil/analyze
 * Submit soil photo for analysis
 * Accepts: multipart/form-data with image file + metadata
 */
router.post('/soil/analyze', upload.single('soil_image'), async (req, res) => {
  try {
    if (!soilAnalysisReady) {
      return res.status(503).json({
        error: 'Soil analysis service temporarily unavailable',
        message: 'Computer vision models are loading. Please try again in a few minutes.'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: 'No image provided',
        message: 'Please upload a soil image for analysis'
      });
    }

    // Extract metadata from request
    const {
      latitude,
      longitude,
      analysis_type = 'complete',
      farm_name,
      field_identifier,
      sampling_depth = 'surface'
    } = req.body;

    // Validate GPS coordinates if provided
    let gpsCoordinates = null;
    if (latitude && longitude) {
      const lat = parseFloat(latitude);
      const lon = parseFloat(longitude);
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        gpsCoordinates = { latitude: lat, longitude: lon };
      }
    }

    // Create job for mesh processing
    const jobData = {
      task_type: 'soil-analysis',
      imageUrl: `/uploads/soil-images/${req.file.filename}`,
      analysisType: analysis_type,
      gpsCoordinates,
      metadata: {
        farm_name,
        field_identifier,
        sampling_depth,
        original_filename: req.file.originalname,
        upload_timestamp: new Date().toISOString()
      }
    };

    // For now, process immediately (in production, would queue via mesh)
    const mockJob = { id: `soil_${Date.now()}`, data: jobData };
    const result = await soilAnalysis.processJob(mockJob);

    // Store result for later retrieval
    const analysisId = result.analysisId;
    const resultPath = path.join(__dirname, '../results', `${analysisId}.json`);
    await fs.mkdir(path.dirname(resultPath), { recursive: true });
    await fs.writeFile(resultPath, JSON.stringify(result, null, 2));

    res.json({
      analysis_id: analysisId,
      status: 'completed',
      processing_time_ms: result.metadata.processingTimeMs,
      results: result.results,
      estimated_cost: getPricingForAnalysisType(analysis_type),
      recommendations: result.results.recommendations,
      next_steps: [
        'Review recommendations and prioritize based on growing season',
        'Consider follow-up analysis in 2-3 months to track improvements',
        'Contact local agricultural extension for implementation support'
      ]
    });

  } catch (error) {
    console.error('Soil analysis error:', error);
    res.status(500).json({
      error: 'Analysis failed',
      message: error.message,
      support: 'Contact farmers@moilol.com for assistance'
    });
  }
});

/**
 * GET /agricultural/soil/results/:analysisId
 * Retrieve previous soil analysis results
 */
router.get('/soil/results/:analysisId', async (req, res) => {
  try {
    const { analysisId } = req.params;
    const resultPath = path.join(__dirname, '../results', `${analysisId}.json`);
    
    const resultData = await fs.readFile(resultPath, 'utf8');
    const result = JSON.parse(resultData);
    
    res.json({
      analysis_id: analysisId,
      results: result.results,
      metadata: result.metadata,
      retrieved_at: new Date().toISOString()
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.status(404).json({
        error: 'Analysis not found',
        message: 'The specified analysis ID was not found'
      });
    } else {
      console.error('Result retrieval error:', error);
      res.status(500).json({
        error: 'Failed to retrieve results',
        message: 'Please contact support if this problem persists'
      });
    }
  }
});

/**
 * POST /agricultural/weather/subscribe
 * Subscribe to weather alerts for specific coordinates
 */
router.post('/weather/subscribe', (req, res) => {
  // Placeholder for weather alert subscription
  const { latitude, longitude, alert_types, phone_number, email } = req.body;
  
  res.json({
    status: 'coming_soon',
    message: 'Weather alert service planned for Q2 2026',
    waitlist: 'Added to early access waitlist',
    estimated_launch: '2026-06-01',
    contact: 'weather@moilol.com'
  });
});

/**
 * GET /agricultural/knowledge/search
 * Search indigenous knowledge database
 */
router.get('/knowledge/search', (req, res) => {
  // Placeholder for knowledge database search
  const { query, region, practice_type } = req.query;
  
  res.json({
    status: 'coming_soon',
    message: 'Indigenous knowledge database in development',
    search_query: query,
    planned_features: [
      'Traditional crop varieties database',
      'Seasonal practice calendar',
      'Community governance tools',
      'Oral history preservation'
    ],
    estimated_launch: '2026-09-01',
    contact: 'knowledge@moilol.com'
  });
});

// Utility functions

function getPricingForAnalysisType(analysisType) {
  const pricing = {
    'complete': '$5.00',
    'quick': '$2.00',
    'texture-only': '$1.00'
  };
  return pricing[analysisType] || pricing.complete;
}

/**
 * GET /agricultural/demo
 * Demo page for soil analysis service
 */
router.get('/demo', (req, res) => {
  const demoHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>IC Mesh Agricultural Services Demo</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .demo-form { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .result { background: #e8f5e9; padding: 15px; border-radius: 5px; margin: 10px 0; }
        .error { background: #ffebee; color: #c62828; }
        .info { background: #e3f2fd; color: #1565c0; }
        button { background: #4caf50; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
        input[type="file"] { margin: 10px 0; }
        .capabilities { background: #fff3e0; padding: 15px; border-radius: 5px; }
    </style>
</head>
<body>
    <h1>🌱 IC Mesh Agricultural Services</h1>
    <p>Decentralized compute infrastructure serving land regeneration</p>
    
    <div class="capabilities">
        <h3>Available Services</h3>
        <ul>
            <li><strong>Soil Analysis:</strong> Computer vision analysis of soil photos ($1-5)</li>
            <li><strong>Weather Alerts:</strong> Hyperlocal agricultural forecasting (Coming Q2 2026)</li>
            <li><strong>Knowledge Base:</strong> Traditional farming practices database (Coming Q3 2026)</li>
        </ul>
    </div>

    <div class="demo-form">
        <h3>Try Soil Analysis (Demo)</h3>
        <form id="soilForm" enctype="multipart/form-data">
            <div>
                <label>Upload soil photo:</label><br>
                <input type="file" name="soil_image" accept="image/*" required>
            </div>
            <div>
                <label>Analysis type:</label><br>
                <select name="analysis_type">
                    <option value="complete">Complete Analysis ($5)</option>
                    <option value="quick">Quick Analysis ($2)</option>
                    <option value="texture-only">Texture Only ($1)</option>
                </select>
            </div>
            <div>
                <label>Farm/Field Name (optional):</label><br>
                <input type="text" name="farm_name" placeholder="e.g. North Field">
            </div>
            <div>
                <label>Latitude (optional):</label>
                <input type="number" step="any" name="latitude" placeholder="45.5152">
                <label>Longitude (optional):</label>
                <input type="number" step="any" name="longitude" placeholder="-122.6784">
            </div>
            <button type="submit">Analyze Soil</button>
        </form>
    </div>

    <div id="results"></div>

    <script>
        document.getElementById('soilForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const results = document.getElementById('results');
            
            results.innerHTML = '<div class="info">Processing soil analysis...</div>';
            
            try {
                const response = await fetch('/agricultural/soil/analyze', {
                    method: 'POST',
                    body: formData
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    results.innerHTML = \`
                        <div class="result">
                            <h3>Analysis Complete!</h3>
                            <p><strong>Analysis ID:</strong> \${data.analysis_id}</p>
                            <p><strong>Processing Time:</strong> \${data.processing_time_ms}ms</p>
                            <p><strong>Estimated Cost:</strong> \${data.estimated_cost}</p>
                            
                            <h4>Results:</h4>
                            <pre>\${JSON.stringify(data.results, null, 2)}</pre>
                            
                            \${data.recommendations && data.recommendations.length > 0 ? \`
                                <h4>Recommendations:</h4>
                                <ul>
                                    \${data.recommendations.map(rec => 
                                        \`<li><strong>\${rec.category}:</strong> \${rec.action} (\${rec.timeline})</li>\`
                                    ).join('')}
                                </ul>
                            \` : ''}
                        </div>
                    \`;
                } else {
                    results.innerHTML = \`<div class="result error">Error: \${data.message}</div>\`;
                }
            } catch (error) {
                results.innerHTML = \`<div class="result error">Network error: \${error.message}</div>\`;
            }
        });
    </script>
</body>
</html>`;
  
  res.send(demoHtml);
});

module.exports = router;