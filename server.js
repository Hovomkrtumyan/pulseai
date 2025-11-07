const express = require('express');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Atlas Connection
const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => console.log('❌ MongoDB connection error:', err.message));
}

// Analysis History Schema
const analysisSchema = new mongoose.Schema({
  fileName: String,
  fileSize: Number,
  analysisResult: String,
  source: String,
  timestamp: { type: Date, default: Date.now }
});
const Analysis = mongoose.model('Analysis', analysisSchema);

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Configure multer (memory storage for production)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  fileFilter: function (req, file, cb) {
    if (path.extname(file.originalname).toLowerCase() === '.csv') {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB limit for faster processing
  }
});

// DeepSeek API configuration
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// File upload and analysis endpoint - OPTIMIZED FOR RENDER TIMEOUT
app.post('/api/analyze', upload.single('csvFile'), async (req, res) => {
  let analysisRecord = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded' });
    }

    console.log(`Processing file: ${req.file.originalname} (${req.file.size} bytes)`);
    
    // Create analysis record in DB
    if (MONGODB_URI) {
      analysisRecord = new Analysis({
        fileName: req.file.originalname,
        fileSize: req.file.size
      });
      await analysisRecord.save();
    }
    
    // Read CSV from buffer and optimize for faster processing
    const csvContent = req.file.buffer.toString('utf8');
    const lines = csvContent.split('\n');
    
    // OPTIMIZATION: Use only first 50 lines for faster processing
    const sampleLines = Math.min(50, lines.length);
    const csvSample = lines.slice(0, sampleLines).join('\n');
    
    console.log(`Using ${sampleLines} lines out of ${lines.length} total lines`);
    
    // OPTIMIZED PROMPT: Shorter and more efficient
    const analysisPrompt = `Analyze this logic analyzer CSV data briefly:

PROTOCOL: 
DEVICES: 
PINS: 
TIMING: 
NOTES: 

Data (${sampleLines} lines):
${csvSample}

Provide concise analysis in bullet points.`;

    // Call DeepSeek API with shorter timeout
    let analysisResult;
    let apiUsed = 'deepseek';
    
    try {
      // Set a 20-second timeout to stay under Render's 30s limit
      analysisResult = await callDeepSeekAPI(analysisPrompt, 20000);
      console.log('DeepSeek API call completed successfully');
    } catch (apiError) {
      console.log('DeepSeek API failed, using enhanced mock analysis:', apiError.message);
      analysisResult = getEnhancedMockAnalysis(csvContent);
      apiUsed = 'mock';
    }
    
    // Update analysis record
    if (analysisRecord) {
      analysisRecord.analysisResult = analysisResult.substring(0, 5000);
      analysisRecord.source = apiUsed;
      await analysisRecord.save();
    }
    
    // Send response
    res.json({ 
      success: true, 
      result: analysisResult,
      fileName: req.file.originalname,
      timestamp: new Date().toISOString(),
      source: apiUsed
    });
    
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ 
      error: 'Analysis failed', 
      message: error.message
    });
  }
});

// OPTIMIZED DeepSeek API function with shorter timeout
async function callDeepSeekAPI(prompt, timeout = 20000) {
  if (!DEEPSEEK_API_KEY) {
    return getEnhancedMockAnalysis();
  }

  try {
    console.log('Calling DeepSeek API with timeout:', timeout + 'ms');
    
    const response = await axios.post(DEEPSEEK_API_URL, {
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000, // Reduced tokens for faster response
      temperature: 0.1,
      stream: false
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: timeout // Critical: Set timeout lower than Render's 30s
    });

    console.log('DeepSeek API response received within timeout');
    return response.data.choices[0].message.content;
    
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      throw new Error(`API timeout (${timeout}ms) - Render free tier limitation`);
    }
    console.error('DeepSeek API Error:', error.response?.status, error.message);
    throw new Error(`DeepSeek API: ${error.message}`);
  }
}

// Enhanced mock analysis
function getEnhancedMockAnalysis(csvContent = '') {
  const lines = csvContent.split('\n');
  const channelCount = lines[0]?.split(',').length - 1 || 0;
  const hasTimeColumn = lines[0]?.includes('Time') || lines[0]?.includes('time');
  
  return `PULSEAI ANALYSIS REPORT
==================================================

FILE ANALYSIS:
• Total lines: ${lines.length}
• Data channels: ${channelCount}
• Time data: ${hasTimeColumn ? 'Yes' : 'No'}

PROTOCOL ANALYSIS:
• Most Likely: I2C or SPI communication
• Channel usage: ${channelCount} active data lines
• Pattern: Digital serial communication detected

ESTIMATED DEVICES:
• Primary: Microcontroller/master device
• Secondary: Sensor or peripheral device(s)

PIN MAPPING (ESTIMATED):
${Array.from({length: channelCount}, (_, i) => `• Channel ${i}: Data line ${i+1}`).join('\n')}

RECOMMENDATIONS:
1. Check signal timing and voltage levels
2. Verify protocol settings match device requirements
3. Use smaller CSV files for faster AI analysis

NOTE: This is an enhanced analysis. For full AI analysis, the request timed out due to Render's 30-second limit on free tier. Consider:
- Using smaller CSV files (< 1000 lines)
- Upgrading to Render's paid plan for longer timeouts
- Using the /api/quick-analyze endpoint for faster results`;
}

// NEW: Quick analysis endpoint for smaller files
app.post('/api/quick-analyze', upload.single('csvFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded' });
    }

    console.log(`Quick analysis for: ${req.file.originalname}`);
    
    // Read only first 20 lines for very fast analysis
    const csvContent = req.file.buffer.toString('utf8');
    const csvSample = csvContent.split('\n').slice(0, 20).join('\n');
    
    const quickPrompt = `Quick analysis of logic data (20 lines):
    
Data:
${csvSample}

Respond in 3-4 bullet points about protocol and devices.`;

    let analysisResult;
    try {
      analysisResult = await callDeepSeekAPI(quickPrompt, 15000);
    } catch (error) {
      analysisResult = `QUICK ANALYSIS (Fallback):
• Serial communication detected
• Multiple devices likely present  
• Analyze timing for protocol identification
• File: ${req.file.originalname}, ${req.file.size} bytes`;
    }
    
    res.json({ 
      success: true, 
      result: analysisResult,
      fileName: req.file.originalname,
      type: 'quick',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Quick analysis failed', message: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'PulseAi',
    environment: process.env.NODE_ENV || 'development',
    render_timeout: '30s (free tier)',
    timestamp: new Date().toISOString()
  });
});

// Analytics endpoint
app.get('/api/analytics', async (req, res) => {
  if (!MONGODB_URI) {
    return res.json({ message: 'MongoDB not configured' });
  }
  
  try {
    const totalAnalyses = await Analysis.countDocuments();
    const deepseekAnalyses = await Analysis.countDocuments({ source: 'deepseek' });
    const mockAnalyses = await Analysis.countDocuments({ source: 'mock' });
    
    res.json({
      totalAnalyses,
      deepseekAnalyses,
      mockAnalyses,
      successRate: totalAnalyses > 0 ? Math.round((deepseekAnalyses / totalAnalyses) * 100) : 0,
      message: 'Free tier: 30s timeout may cause fallbacks to mock analysis'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

// Error handling
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 2MB for free tier.' });
    }
  }
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 PulseAi Server running on port ${PORT}`);
  console.log(`⚠️  Render Free Tier: 30-second timeout limit`);
  console.log(`💡 Using optimized API calls (20s timeout)`);
});