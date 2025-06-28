const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const { google } = require('googleapis');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/lifetracker', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB');
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

// Define Mongoose Schemas
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now }
});

const userDataSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  pillars: {
    type: [{
      id: Number,
      name: String,
      value: Number,
      goal: Number,
      color: String,
      icon: String,
      description: String
    }],
    default: [
      { id: 1, name: 'Financial Success', value: 50, goal: 80, color: '#FFD700', icon: '💰', description: 'Wealth & Financial Freedom' },
      { id: 2, name: 'Health & Fitness', value: 50, goal: 90, color: '#4CAF50', icon: '💪', description: 'Physical & Mental Well-being' },
      { id: 3, name: 'Relationships', value: 50, goal: 85, color: '#2196F3', icon: '❤️', description: 'Family, Friends & Community' },
      { id: 4, name: 'Personal Growth', value: 50, goal: 75, color: '#9C27B0', icon: '🧠', description: 'Learning & Self-Development' },
      { id: 5, name: 'Purpose & Joy', value: 50, goal: 90, color: '#E91E63', icon: '✨', description: 'Fulfillment & Happiness' }
    ]
  },
  history: [{
    date: Date,
    values: [{
      name: String,
      value: Number
    }],
    overall: Number
  }],
  settings: {
    userName: String,
    dailyReminder: { type: Boolean, default: false },
    weeklyReport: { type: Boolean, default: false }
  },
  updatedAt: { type: Date, default: Date.now }
});

// Create models
const User = mongoose.model('User', userSchema);
const UserData = mongoose.model('UserData', userDataSchema);

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize Google Docs API
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}'),
  scopes: ['https://www.googleapis.com/auth/documents.readonly'],
});

const docs = google.docs({ version: 'v1', auth });

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Document IDs
const DOCUMENT_IDS = {
  financial: [
    '13ng_EnHnFt-vJ60RV7ek9msWdwlLwo60QGd6t36UqCM',
    '11VKfDVcShlSQjC2RsQSLBbFn1bI7W0h9tw5v5FYVP60'
  ],
  purpose: [
    '1So9QI--hsQUj2FEKQoXcrjGLIo6zZzT02Wrm8MexP0E'
  ]
};
// Document functions
async function fetchGoogleDoc(documentId) {
  try {
    const res = await docs.documents.get({ documentId });
    const content = res.data;
    
    let text = '';
    content.body.content.forEach(element => {
      if (element.paragraph) {
        element.paragraph.elements.forEach(elem => {
          if (elem.textRun) {
            text += elem.textRun.content;
          }
        });
      }
    });
    
    return text;
  } catch (error) {
    console.error(`Error fetching document ${documentId}:`, error.message);
    return '';
  }
}

function extractKeyContent(text, maxLength = 4000) {
  const lines = text.split('\n');
  const keyContent = [];
  let currentSection = '';
  
  for (const line of lines) {
    if (line.match(/^\d+\.|^[A-Z][^.]+:|^•|Key|Important|Essential|Step|Method/)) {
      if (currentSection) {
        keyContent.push(currentSection);
        currentSection = '';
      }
      currentSection = line;
    } else if (currentSection && line.trim()) {
      currentSection += '\n' + line;
    }
    
    if (keyContent.join('\n').length > maxLength) break;
  }
  
  if (currentSection) keyContent.push(currentSection);
  
  return keyContent.join('\n\n');
}

let documentCache = {};
let documentSummaries = {};
let cacheTimestamp = 0;

async function getDocumentContent() {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  
  if (now - cacheTimestamp > ONE_HOUR || Object.keys(documentCache).length === 0) {
    console.log('Refreshing document cache...');
    
    const allCategories = ['financial', 'health', 'relationships', 'growth', 'purpose', 'ecommerce'];
    allCategories.forEach(cat => {
      documentCache[cat] = '';
      documentSummaries[cat] = '';
    });
    
    for (const [category, docIds] of Object.entries(DOCUMENT_IDS)) {
      const ids = Array.isArray(docIds) ? docIds : [docIds];
      
      for (const docId of ids) {
        console.log(`Fetching ${category} document: ${docId}`);
        const content = await fetchGoogleDoc(docId);
        
        if (content) {
          documentCache[category] += content;
          console.log(`Extracting key content for ${category} (${content.length} chars)`);
          const keyContent = extractKeyContent(content);
          documentSummaries[category] += `\n\n--- ${category.toUpperCase()} KEY CONTENT ---\n${keyContent}`;
        }
      }
    }
    
    cacheTimestamp = now;
  }
  
  return { full: documentCache, summaries: documentSummaries };
}

async function searchDocuments(query, category = null) {
  const { full } = await getDocumentContent();
  const results = [];
  const searchTerm = query.toLowerCase();
  
  const categories = category ? [category] : Object.keys(full);
  
  for (const cat of categories) {
    const content = full[cat];
    if (!content) continue;
    
    const sections = content.split(/\n\n+/);
    const matches = sections.filter(section => 
      section.toLowerCase().includes(searchTerm)
    ).slice(0, 5);
    
    if (matches.length > 0) {
      results.push({
        category: cat,
        matches: matches
      });
    }
  }
  
  return results;
}

// ============= AUTHENTICATION ENDPOINTS =============

// Sign up endpoint
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      name,
      email,
      password: hashedPassword
    });

    await user.save();

    const userData = new UserData({
      userId: user._id
    });

    await userData.save();

    const token = jwt.sign(
      { id: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { 
        id: user._id, 
        name: user.name, 
        email: user.email 
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign(
      { id: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { 
        id: user._id, 
        name: user.name, 
        email: user.email 
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Verify token endpoint
app.get('/api/auth/verify', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({
      user: { 
        id: user._id, 
        name: user.name, 
        email: user.email 
      }
    });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Forgot password endpoint
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  
  const user = await User.findOne({ email });
  if (!user) {
    return res.json({ message: 'If an account exists, a reset link has been sent' });
  }

  const resetToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: '1h' });
  console.log(`Password reset token for ${email}: ${resetToken}`);

  res.json({ message: 'If an account exists, a reset link has been sent' });
});

// ============= USER DATA ENDPOINTS =============

// Get user data
app.get('/api/user/data', authenticateToken, async (req, res) => {
  try {
    const userData = await UserData.findOne({ userId: req.user.id });
    
    if (!userData) {
      return res.status(404).json({ message: 'User data not found' });
    }

    res.json({
      pillars: userData.pillars,
      history: userData.history,
      settings: userData.settings
    });
  } catch (error) {
    console.error('Get data error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Save user data
app.post('/api/user/data', authenticateToken, async (req, res) => {
  try {
    const { pillars, history, settings } = req.body;
    
    const userData = await UserData.findOneAndUpdate(
      { userId: req.user.id },
      {
        $set: {
          ...(pillars && { pillars }),
          ...(history && { history }),
          ...(settings && { settings }),
          updatedAt: new Date()
        }
      },
      { new: true, upsert: true }
    );

    res.json({ 
      success: true, 
      message: 'Data saved successfully' 
    });
  } catch (error) {
    console.error('Save data error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============= AI ENDPOINTS =============

// AI Coach endpoint
app.post('/api/ai-coach', authenticateToken, async (req, res) => {
  try {
    const { message, context } = req.body;
    
    // Get user's current data
    const userData = await UserData.findOne({ userId: req.user.id });
    
    // Prepare context for AI
    const systemPrompt = `You are a life coach AI assistant helping users improve their life balance across 5 pillars: Financial Success, Health & Fitness, Relationships, Personal Growth, and Purpose & Joy. 
    
Current user data:
${userData ? JSON.stringify(userData.pillars, null, 2) : 'No data available'}

Provide actionable, encouraging advice. Keep responses concise and practical.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      max_tokens: 500,
      temperature: 0.7
    });

    res.json({
      response: completion.choices[0].message.content
    });

  } catch (error) {
    console.error('AI Coach error:', error);
    res.status(500).json({ 
      error: 'Failed to get AI response',
      message: error.message 
    });
  }
});

// AI Insights endpoint
app.post('/api/ai-insights', authenticateToken, async (req, res) => {
  try {
    const { pillars } = req.body;
    
    const prompt = `Based on these life balance scores:
${JSON.stringify(pillars, null, 2)}

Provide 3 specific, actionable insights to help improve the lowest scoring areas. Format as a JSON array of objects with 'pillar' and 'insight' fields.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a life coach providing data-driven insights. Always respond with valid JSON." },
        { role: "user", content: prompt }
      ],
      max_tokens: 500,
      temperature: 0.7
    });

    const insights = JSON.parse(completion.choices[0].message.content);
    
    res.json({ insights });

  } catch (error) {
    console.error('AI Insights error:', error);
    res.status(500).json({ 
      error: 'Failed to generate insights',
      message: error.message 
    });
  }
});

// Document search endpoint (using your existing document functions)
app.post('/api/search-documents', authenticateToken, async (req, res) => {
  try {
    const { query, category } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const results = await searchDocuments(query, category);
    
    res.json({ results });

  } catch (error) {
    console.error('Document search error:', error);
    res.status(500).json({ 
      error: 'Failed to search documents',
      message: error.message 
    });
  }
});

// Get document summaries endpoint
app.get('/api/document-summaries', authenticateToken, async (req, res) => {
  try {
    const { summaries } = await getDocumentContent();
    
    res.json({ summaries });

  } catch (error) {
    console.error('Document summaries error:', error);
    res.status(500).json({ 
      error: 'Failed to get document summaries',
      message: error.message 
    });
  }
});

// Documents status endpoint
app.get('/api/documents-status', authenticateToken, async (req, res) => {
  try {
    // Get the current document cache status
    const { full, summaries } = await getDocumentContent();
    
    // Check which categories have content loaded
    const status = {
      financial: {
        loaded: !!(full.financial && full.financial.length > 0),
        documentCount: DOCUMENT_IDS.financial ? DOCUMENT_IDS.financial.length : 0
      },
      purpose: {
        loaded: !!(full.purpose && full.purpose.length > 0),
        documentCount: DOCUMENT_IDS.purpose ? DOCUMENT_IDS.purpose.length : 0
      },
      health: {
        loaded: !!(full.health && full.health.length > 0),
        documentCount: 0 // No health documents defined in DOCUMENT_IDS
      },
      relationships: {
        loaded: !!(full.relationships && full.relationships.length > 0),
        documentCount: 0 // No relationships documents defined in DOCUMENT_IDS
      },
      growth: {
        loaded: !!(full.growth && full.growth.length > 0),
        documentCount: 0 // No growth documents defined in DOCUMENT_IDS
      }
    };
    
    res.json(status);
    
  } catch (error) {
    console.error('Documents status error:', error);
    res.status(500).json({ 
      error: 'Failed to get documents status',
      message: error.message 
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
