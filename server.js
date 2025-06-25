const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

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

// Document IDs - Only real documents, no placeholders
const DOCUMENT_IDS = {
  financial: [
    '13ng_EnHnFt-vJ60RV7ek9msWdwlLwo60QGd6t36UqCM', // Main financial principles
    '11VKfDVcShlSQjC2RsQSLBbFn1bI7W0h9tw5v5FYVP60'  // E-commerce strategies
  ],
  purpose: [
    '1So9QI--hsQUj2FEKQoXcrjGLIo6zZzT02Wrm8MexP0E'  // Purpose and fulfillment doc
  ]
};

// Function to fetch and parse Google Doc content
async function fetchGoogleDoc(documentId) {
  try {
    const res = await docs.documents.get({ documentId });
    const content = res.data;
    
    // Extract text from document
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

// Cache for document content (refreshes every hour)
let documentCache = {};
let cacheTimestamp = 0;

async function getDocumentContent() {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  
  // Refresh cache if older than 1 hour or empty
  if (now - cacheTimestamp > ONE_HOUR || Object.keys(documentCache).length === 0) {
    console.log('Refreshing document cache...');
    
    // Initialize all categories
    const allCategories = ['financial', 'health', 'relationships', 'growth', 'purpose', 'ecommerce'];
    allCategories.forEach(cat => {
      documentCache[cat] = '';
    });
    
    // Load documents that exist
    for (const [category, docIds] of Object.entries(DOCUMENT_IDS)) {
      const ids = Array.isArray(docIds) ? docIds : [docIds];
      
      for (const docId of ids) {
        console.log(`Fetching ${category} document: ${docId}`);
        const content = await fetchGoogleDoc(docId);
        if (content) {
          documentCache[category] += `\n\n--- Document ---\n\n${content}`;
        }
      }
    }
    
    cacheTimestamp = now;
  }
  
  return documentCache;
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'Life Tracker AI Backend is running!' });
});

// AI Coach endpoint with Google Docs integration
app.post('/api/ai-coach', async (req, res) => {
  try {
    const { message, context } = req.body;
    
    // Fetch latest document content
    const documents = await getDocumentContent();
    
    // Create comprehensive system prompt with document content
    const systemPrompt = `You are a direct, no-nonsense life coach with access to comprehensive documents. Your responses must be practical and actionable.

AVAILABLE KNOWLEDGE BASE:

FINANCIAL SUCCESS & E-COMMERCE:
${documents.financial || 'No financial documents loaded yet'}

PURPOSE & JOY:
${documents.purpose || 'No purpose document loaded yet'}

HEALTH & FITNESS:
${documents.health || 'No health documents loaded yet - using general principles'}

RELATIONSHIPS:
${documents.relationships || 'No relationship documents loaded yet - using general principles'}

PERSONAL GROWTH:
${documents.growth || 'No growth documents loaded yet - using general principles'}

USER'S CURRENT STATUS:
- Financial Success: ${context.pillars[0].value}% (Goal: ${context.pillars[0].goal}%)
- Health & Fitness: ${context.pillars[1].value}% (Goal: ${context.pillars[1].goal}%)
- Relationships: ${context.pillars[2].value}% (Goal: ${context.pillars[2].goal}%)
- Personal Growth: ${context.pillars[3].value}% (Goal: ${context.pillars[3].goal}%)
- Purpose & Joy: ${context.pillars[4].value}% (Goal: ${context.pillars[4].goal}%)
- Overall Balance: ${context.overallScore}%
- Weakest Area: ${context.lowestPillar.name} at ${context.lowestPillar.value}%

STRICT INSTRUCTIONS:

1. ALWAYS cite specific information from the documents when available. Use exact quotes.

2. For business/e-commerce questions:
   - Pull EXACT strategies from the financial/e-commerce documents
   - Give specific numbers, tools, and platforms mentioned
   - Provide actionable steps from the documents

3. For areas without documents loaded:
   - Be honest that no specific document is loaded for that area
   - Offer to help with the areas where documents ARE loaded
   - Suggest they add documents for more specific guidance

4. Response style:
   - Start with the most relevant document information
   - Be direct - no fluff or generic motivation
   - If documents don't cover something, say so clearly

NEVER give generic advice when documents are available. ALWAYS ground responses in the actual document content.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      temperature: 0.7,
      max_tokens: 500
    });

    res.json({ 
      success: true,
      response: completion.choices[0].message.content 
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get AI response',
      details: error.message 
    });
  }
});

// Endpoint to check which documents are loaded
app.get('/api/documents-status', async (req, res) => {
  const documents = await getDocumentContent();
  const status = {
    financial: {
      loaded: documents.financial.length > 0,
      documentCount: DOCUMENT_IDS.financial ? DOCUMENT_IDS.financial.length : 0,
      characterCount: documents.financial.length
    },
    purpose: {
      loaded: documents.purpose.length > 0,
      documentCount: DOCUMENT_IDS.purpose ? DOCUMENT_IDS.purpose.length : 0,
      characterCount: documents.purpose.length
    },
    health: { loaded: false, documentCount: 0, characterCount: 0 },
    relationships: { loaded: false, documentCount: 0, characterCount: 0 },
    growth: { loaded: false, documentCount: 0, characterCount: 0 },
    ecommerce: { loaded: false, documentCount: 0, characterCount: 0 }
  };
  
  res.json(status);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Initializing document cache...');
  getDocumentContent().then(() => {
    console.log('Document cache initialized');
  });
});
