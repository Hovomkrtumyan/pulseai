const express = require('express');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Connection (Optional - for storing analysis history)
const MONGODB_URI = process.env.MONGODB_URI;

if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => console.log('❌ MongoDB connection error:', err.message));
}

// Analysis History Schema (Optional)
const analysisSchema = new mongoose.Schema({
  fileName: String,
  fileSize: Number,
  analysisResult: String,
  source: String,
  timestamp: { type: Date, default: Date.now },
  ipAddress: String
});

const Analysis = mongoose.model('Analysis', analysisSchema);

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Security middleware for production
app.use((req, res, next) => {
  // Basic security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Configure multer for file uploads (memory storage for production)
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
    fileSize: 5 * 1024 * 1024 // 5MB limit for production
  }
});

// DeepSeek API configuration
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// File upload and analysis endpoint
app.post('/api/analyze', upload.single('csvFile'), async (req, res) => {
  let analysisRecord = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded' });
    }

    console.log(`Processing file: ${req.file.originalname}`);
    
    // Create analysis record in DB if MongoDB is connected
    if (MONGODB_URI) {
      analysisRecord = new Analysis({
        fileName: req.file.originalname,
        fileSize: req.file.size,
        ipAddress: req.ip || req.connection.remoteAddress
      });
      await analysisRecord.save();
    }
    
    // Read the CSV file from buffer
    const csvContent = req.file.buffer.toString('utf8');
    
    // Prepare the prompt for DeepSeek
    const analysisPrompt = `You are an expert electronics engineer and protocol analyzer. Please analyze this logic analyzer CSV data and provide:

1. PROTOCOL IDENTIFICATION: What communication protocol is being used (I2C, SPI, UART, 1-Wire, CAN, etc.)? Provide confidence level.
2. DEVICE ANALYSIS: What types of devices are communicating? Identify master/slave relationships.
3. PIN MAPPING: Name each channel/pin with its likely function.
4. TIMING ANALYSIS: Calculate baud rates, clock frequencies, timing parameters.
5. DATA DECODING: Decode any visible data transactions or messages.
6. ANOMALIES: Note any signal integrity issues or anomalies.
7. RECOMMENDATIONS: Provide suggestions for further analysis or system improvements.

CSV Data Sample (first 150 lines):
${csvContent.split('\n').slice(0, 150).join('\n')}

Please structure your response in a clear, technical format suitable for electronics engineers.`;

    // Call DeepSeek API
    let analysisResult;
    let apiUsed = 'deepseek';
    
    try {
      analysisResult = await callDeepSeekAPI(analysisPrompt);
    } catch (apiError) {
      console.log('DeepSeek API failed, using enhanced mock analysis:', apiError.message);
      analysisResult = getEnhancedMockAnalysis(csvContent);
      apiUsed = 'mock';
    }
    
    // Update analysis record with results
    if (analysisRecord) {
      analysisRecord.analysisResult = analysisResult.substring(0, 10000); // Limit storage
      analysisRecord.source = apiUsed;
      await analysisRecord.save();
    }
    
    // Send the analysis result back to client
    res.json({ 
      success: true, 
      result: analysisResult,
      fileName: req.file.originalname,
      timestamp: new Date().toISOString(),
      source: apiUsed,
      analysisId: analysisRecord?._id
    });
    
  } catch (error) {
    console.error('Analysis error:', error);
    
    res.status(500).json({ 
      error: 'Analysis failed', 
      message: error.message,
      details: process.env.NODE_ENV === 'production' ? 'Please try again later' : error.stack
    });
  }
});

// Function to call DeepSeek API
async function callDeepSeekAPI(prompt) {
  if (!DEEPSEEK_API_KEY || DEEPSEEK_API_KEY === 'your_deepseek_api_key_here') {
    console.log('Using mock response - no API key configured');
    return getEnhancedMockAnalysis();
  }

  try {
    console.log('Calling DeepSeek API...');
    
    const response = await axios.post(DEEPSEEK_API_URL, {
      model: "deepseek-chat",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 3000,
      temperature: 0.1,
      stream: false
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 45000 // 45 second timeout for production
    });

    console.log('DeepSeek API response received');
    return response.data.choices[0].message.content;
    
  } catch (error) {
    console.error('DeepSeek API Error:', error.response?.status, error.message);
    
    if (error.response?.status === 401) {
      throw new Error('Invalid DeepSeek API key');
    } else if (error.response?.status === 402) {
      throw new Error('Payment required - check your DeepSeek account balance');
    } else if (error.response?.status === 429) {
      throw new Error('Rate limit exceeded - try again later');
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('API request timeout - try again with a smaller file');
    } else {
      throw new Error(`DeepSeek API error: ${error.message}`);
    }
  }
}

// Enhanced mock analysis
function getEnhancedMockAnalysis(csvContent = '') {
  const lines = csvContent.split('\n');
  const channelCount = lines[0]?.split(',').length - 1 || 0;
  
  return `PULSEAI ANALYSIS REPORT
==================================================

PROTOCOL: I2C (Detected with 85% confidence)

DEVICES:
- Master: Microcontroller
- Slave 1: Sensor device (address 0x44)
- Slave 2: Memory device (address 0x50)

PIN MAPPING:
- Channel 0: SCL (Serial Clock)
- Channel 1: SDA (Serial Data)
- Channel 2: Optional control line

TIMING ANALYSIS:
- Clock Frequency: ~100 kHz
- Data Rate: Stable communication
- Signal Quality: Good

RECOMMENDATIONS:
- Verify pull-up resistors on I2C lines
- Check device addressing matches datasheets
- Confirm power supply stability

NOTE: This is an enhanced mock analysis. For real AI analysis, ensure your DeepSeek API key is properly configured and has sufficient credits.`;
}

// Analysis history endpoint (optional)
app.get('/api/analytics', async (req, res) => {
  if (!MONGODB_URI) {
    return res.json({ message: 'MongoDB not configured' });
  }
  
  try {
    const totalAnalyses = await Analysis.countDocuments();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const analysesToday = await Analysis.countDocuments({ timestamp: { $gte: today } });
    
    res.json({
      totalAnalyses,
      analysesToday,
      message: 'Analytics data retrieved'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

// Test API connection endpoint
app.get('/api/test-deepseek', async (req, res) => {
  try {
    if (!DEEPSEEK_API_KEY) {
      return res.json({ 
        success: false, 
        message: 'No API key configured' 
      });
    }

    const response = await axios.post(DEEPSEEK_API_URL, {
      model: "deepseek-chat",
      messages: [{ 
        role: "user", 
        content: "Respond with just 'PulseAi API test successful'" 
      }],
      max_tokens: 20,
      temperature: 0.1
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    res.json({ 
      success: true, 
      message: 'API connection successful',
      response: response.data.choices[0].message.content
    });
    
  } catch (error) {
    res.json({ 
      success: false, 
      message: 'API test failed',
      error: error.message,
      status: error.response?.status
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'PulseAi Logic Analyzer',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
    }
  }
  
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 PulseAi Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Web URL: http://localhost:${PORT}`);
  
  if (!DEEPSEEK_API_KEY) {
    console.log('⚠️  DeepSeek API key not configured');
  } else {
    console.log('✅ DeepSeek API key configured');
  }
  
  if (MONGODB_URI) {
    console.log('✅ MongoDB Atlas connected');
  }
});