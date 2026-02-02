const express = require('express');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

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
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  timestamp: { type: Date, default: Date.now }
});
const Analysis = mongoose.model('Analysis', analysisSchema);

// User Schema
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

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

// Enhanced CSV Analysis with Format Detection
function detectCSVFormat(headers) {
  const headerStr = headers.join(',').toLowerCase();
  
  if (headerStr.includes('time') && headerStr.includes('channel')) {
    return { format: 'Saleae Logic', type: 'standard' };
  }
  if (headerStr.includes('sample') || headerStr.includes('logic')) {
    return { format: 'PulseView/Sigrok', type: 'open_source' };
  }
  if (headerStr.includes('timestamp') || headerStr.includes('state')) {
    return { format: 'Digilent/WaveForms', type: 'digilent' };
  }
  if (headerStr.includes('tick') || headerStr.includes('clk')) {
    return { format: 'Generic/Raw', type: 'raw' };
  }
  return { format: 'Unknown', type: 'unknown' };
}

function analyzeChannels(headers, dataLines) {
  const channels = [];
  
  headers.forEach((header, index) => {
    if (index === 0 && (header.toLowerCase().includes('time') || header.toLowerCase().includes('sample'))) {
      return; // Skip time column
    }
    
    const channelName = header.replace(/["']/g, '').trim();
    const channelData = dataLines.slice(1, Math.min(20, dataLines.length)).map(line => {
      const parts = line.split(',');
      return parts[index]?.trim() || '0';
    });
    
    // Detect signal patterns
    const uniqueValues = [...new Set(channelData)];
    const transitions = channelData.filter((val, i) => i > 0 && val !== channelData[i-1]).length;
    
    channels.push({
      name: channelName,
      index: index,
      uniqueValues: uniqueValues.length,
      transitions: transitions,
      isDigital: uniqueValues.length <= 4,
      isClock: transitions > 5,
      isData: transitions > 0 && transitions <= 10
    });
  });
  
  return channels;
}

function detectProtocol(channels) {
  const digitalChannels = channels.filter(c => c.isDigital);
  
  if (digitalChannels.length === 2) {
    const hasClock = digitalChannels.some(c => c.isClock);
    const hasData = digitalChannels.some(c => c.isData && !c.isClock);
    
    if (hasClock && hasData) {
      return { protocol: 'I2C', confidence: 'High', pins: ['SDA (Data)', 'SCL (Clock)'] };
    }
  }
  
  if (digitalChannels.length >= 3 && digitalChannels.length <= 5) {
    const clockLike = digitalChannels.filter(c => c.isClock).length;
    const dataLike = digitalChannels.filter(c => c.isData).length;
    
    if (clockLike >= 1 && dataLike >= 2) {
      return { protocol: 'SPI', confidence: 'High', pins: ['MOSI', 'MISO', 'SCK', 'CS/SS'] };
    }
  }
  
  if (digitalChannels.length === 1 || digitalChannels.length === 2) {
    return { protocol: 'UART/Serial', confidence: 'Medium', pins: ['TX', 'RX'] };
  }
  
  if (digitalChannels.length > 8) {
    return { protocol: 'Parallel/Unknown', confidence: 'Low', pins: digitalChannels.map((c, i) => `Data_${i}`) };
  }
  
  return { protocol: 'Unknown', confidence: 'Low', pins: digitalChannels.map((c, i) => `Channel_${i}`) };
}

// Device signature database
const deviceSignatures = {
  '0x77': { name: 'BME280', type: 'Temperature/Humidity/Pressure Sensor', protocol: 'I2C', address: '0x77 or 0x76' },
  '0x68': { name: 'MPU6050', type: 'Accelerometer/Gyroscope', protocol: 'I2C', address: '0x68 or 0x69' },
  '0x50': { name: '24Cxx EEPROM', type: 'EEPROM Memory', protocol: 'I2C', address: '0x50-0x57' },
  '0x3C': { name: 'SSD1306', type: 'OLED Display', protocol: 'I2C', address: '0x3C or 0x3D' },
  '0x27': { name: 'PCF8574', type: 'I/O Expander', protocol: 'I2C', address: '0x27 or 0x3F' }
};

// Enhanced mock analysis
function getEnhancedMockAnalysis(csvContent = '') {
  const lines = csvContent.split('\n').filter(line => line.trim());
  const headers = lines[0]?.split(',').map(h => h.trim()) || [];
  const format = detectCSVFormat(headers);
  const channels = analyzeChannels(headers, lines);
  const protocol = detectProtocol(channels);
  
  return `PULSEAI DETAILED ANALYSIS REPORT
==================================================

FILE METADATA:
• Analyzer Format: ${format.format}
• Total Samples: ${lines.length - 1}
• Data Channels: ${channels.length}
• Time Column: ${headers[0] || 'None'}

DETECTED PROTOCOL:
• Protocol: ${protocol.protocol}
• Confidence: ${protocol.confidence}
• Type: ${format.type === 'standard' ? 'Standard Logic Analyzer' : 'Custom Format'}

PIN MAPPING ANALYSIS:
${channels.map((ch, i) => `• ${ch.name}: ${protocol.pins[i] || 'Data Line'} ${ch.isClock ? '(Clock-like)' : ''} ${ch.isData ? '(Data)' : ''}`).join('\n')}

SIGNAL CHARACTERISTICS:
${channels.map(ch => `• ${ch.name}: ${ch.transitions} transitions, ${ch.uniqueValues} unique states${ch.isDigital ? ' (Digital)' : ' (Analog/Mixed)'}`).join('\n')}

ESTIMATED DEVICES:
• Primary: ${protocol.protocol === 'I2C' ? 'I2C Master (Microcontroller)' : protocol.protocol === 'SPI' ? 'SPI Master' : 'Unknown Master'}
• Secondary: ${channels.length > 1 ? 'Connected peripheral(s) detected' : 'No secondary device detected'}

TIMING ANALYSIS:
• Sample Rate: Estimated from time column
• Bus Speed: ${protocol.protocol === 'I2C' ? 'Standard (100kHz) or Fast (400kHz)' : protocol.protocol === 'SPI' ? 'Variable, check clock frequency' : 'Unknown'}

RECOMMENDATIONS:
1. Verify protocol settings match device datasheets
2. Check signal integrity and voltage levels
3. Confirm device addresses for I2C devices
4. Review timing constraints for reliable communication

NOTE: This analysis is based on signal patterns. For device-specific identification, additional signature analysis may be required.`;
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

// Authentication Routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    if (!MONGODB_URI) {
      return res.status(500).json({ error: 'Database not configured' });
    }
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashedPassword });
    await user.save();
    
    res.json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    if (!MONGODB_URI) {
      const mockUser = { id: 'mock', name: 'Demo User', email };
      const token = jwt.sign(mockUser, JWT_SECRET, { expiresIn: '24h' });
      return res.json({ token, user: mockUser });
    }
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { id: user._id, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Protected route example
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    if (!MONGODB_URI) {
      return res.json(req.user);
    }
    
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get profile' });
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