const express = require('express');
const serverless = require('serverless-http');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory storage for serverless (no MongoDB in free tier)
const users = [];
const analyses = [];

// DeepSeek API configuration
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

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

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB limit
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'PulseAi',
    environment: 'production',
    timestamp: new Date().toISOString()
  });
});

// File upload and analysis endpoint
app.post('/api/analyze', upload.single('csvFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded' });
    }

    console.log(`Processing file: ${req.file.originalname}`);
    
    const csvContent = req.file.buffer.toString('utf8');
    const lines = csvContent.split('\n');
    const sampleLines = Math.min(50, lines.length);
    const csvSample = lines.slice(0, sampleLines).join('\n');
    
    const analysisPrompt = `Analyze this logic analyzer CSV data briefly:

Data (${sampleLines} lines):
${csvSample}

Provide concise analysis: Protocol, Devices, Pins, Timing in bullet points.`;

    let analysisResult;
    let apiUsed = 'deepseek';
    
    try {
      if (DEEPSEEK_API_KEY) {
        const response = await axios.post(DEEPSEEK_API_URL, {
          model: "deepseek-chat",
          messages: [{ role: "user", content: analysisPrompt }],
          max_tokens: 1000,
          temperature: 0.1,
          stream: false
        }, {
          headers: {
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 20000
        });
        analysisResult = response.data.choices[0].message.content;
      } else {
        throw new Error('No API key');
      }
    } catch (apiError) {
      console.log('DeepSeek API failed, using mock analysis');
      analysisResult = getEnhancedMockAnalysis(csvContent);
      apiUsed = 'mock';
    }
    
    // Store analysis
    analyses.push({
      fileName: req.file.originalname,
      fileSize: req.file.size,
      result: analysisResult.substring(0, 5000),
      source: apiUsed,
      timestamp: new Date()
    });
    
    res.json({ 
      success: true, 
      result: analysisResult,
      fileName: req.file.originalname,
      timestamp: new Date().toISOString(),
      source: apiUsed
    });
    
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Analysis failed', message: error.message });
  }
});

// Enhanced CSV Analysis
function detectCSVFormat(headers) {
  const headerStr = headers.join(',').toLowerCase();
  
  if (headerStr.includes('time') && headerStr.includes('channel')) {
    return { format: 'Saleae Logic', type: 'standard' };
  }
  if (headerStr.includes('sample') || headerStr.includes('logic')) {
    return { format: 'PulseView/Sigrok', type: 'open_source' };
  }
  return { format: 'Unknown', type: 'unknown' };
}

function analyzeChannels(headers, dataLines) {
  const channels = [];
  
  headers.forEach((header, index) => {
    if (index === 0 && (header.toLowerCase().includes('time') || header.toLowerCase().includes('sample'))) {
      return;
    }
    
    const channelName = header.replace(/["']/g, '').trim();
    const channelData = dataLines.slice(1, Math.min(20, dataLines.length)).map(line => {
      const parts = line.split(',');
      return parts[index]?.trim() || '0';
    });
    
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
  
  return { protocol: 'UART/Serial', confidence: 'Medium', pins: ['TX', 'RX'] };
}

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

DETECTED PROTOCOL:
• Protocol: ${protocol.protocol}
• Confidence: ${protocol.confidence}

PIN MAPPING ANALYSIS:
${channels.map((ch, i) => `• ${ch.name}: ${protocol.pins[i] || 'Data Line'} ${ch.isClock ? '(Clock-like)' : ''} ${ch.isData ? '(Data)' : ''}`).join('\n')}

SIGNAL CHARACTERISTICS:
${channels.map(ch => `• ${ch.name}: ${ch.transitions} transitions, ${ch.uniqueValues} unique states`).join('\n')}

ESTIMATED DEVICES:
• Primary: ${protocol.protocol === 'I2C' ? 'I2C Master (Microcontroller)' : protocol.protocol === 'SPI' ? 'SPI Master' : 'Unknown Master'}
• Secondary: ${channels.length > 1 ? 'Connected peripheral(s) detected' : 'No secondary device detected'}

RECOMMENDATIONS:
1. Verify protocol settings match device datasheets
2. Check signal integrity and voltage levels
3. Review timing constraints for reliable communication`;
}

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
    
    const existingUser = users.find(u => u.email === email);
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = { id: Date.now().toString(), name, email, password: hashedPassword };
    users.push(user);
    
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
    
    const user = users.find(u => u.email === email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Protected route
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  res.json(req.user);
});

module.exports.handler = serverless(app);
