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
  keyFile: './google-credentials.json', // Your service account key file
  scopes: ['https://www.googleapis.com/auth/documents.readonly'],
});

const docs = google.docs({ version: 'v1', auth });

// Document IDs - Now supports multiple docs per category
const DOCUMENT_IDS = {
  financial: [
    '13ng_EnHnFt-vJ60RV7ek9msWdwlLwo60QGd6t36UqCM/edit?tab=t.0#heading=h.q2mx0byt7fz0', // Your main financial principles doc
    '11VKfDVcShlSQjC2RsQSLBbFn1bI7W0h9tw5v5FYVP60/edit?tab=t.0#heading=h.waxohxqw4j1p', // Your e-commerce strategies doc
    'DOC_ID_3'  // Your investment guide doc
  ],
  health: [
    'DOC_ID_4', // Physical fitness doc
    'DOC_ID_5'  // Mental health & stress management doc
  ],
  relationships: [
    'DOC_ID_6', // Family relationships doc
    'DOC_ID_7', // Professional networking doc
    'DOC_ID_8'  // Social connections doc
  ],
  growth: [
    'DOC_ID_9',  // Learning strategies doc
    'DOC_ID_10'  // Mindset principles doc
  ],
  purpose: [
    '1So9QI--hsQUj2FEKQoXcrjGLIo6zZzT02Wrm8MexP0E'  // Purpose and fulfillment doc
  ],
  ecommerce: [
    'DOC_ID_12', // Dropshipping guide
    'DOC_ID_13', // Website optimization doc
    'DOC_ID_14'  // Marketing strategies doc
  ]
};

// Updated function to fetch multiple docs per category
async function getDocumentContent() {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  
  if (now - cacheTimestamp > ONE_HOUR || Object.keys(documentCache).length === 0) {
    console.log('Refreshing document cache...');
    
    for (const [category, docIds] of Object.entries(DOCUMENT_IDS)) {
      documentCache[category] = '';
      
      // Handle both single doc ID (string) and multiple (array)
      const ids = Array.isArray(docIds) ? docIds : [docIds];
      
      for (const docId of ids) {
        if (docId && !docId.includes('DOC_ID')) {
          const content = await fetchGoogleDoc(docId);
          if (content) {
            // Add document separator for clarity
            documentCache[category] += `\n\n--- Document: ${docId} ---\n\n${content}`;
          }
        }
      }
    }
    
    cacheTimestamp = now;
  }
  
  return documentCache;
}

// Optional: Enhanced status endpoint to show all loaded docs
app.get('/api/documents-status', async (req, res) => {
  const status = {};
  
  for (const [category, docIds] of Object.entries(DOCUMENT_IDS)) {
    const ids = Array.isArray(docIds) ? docIds : [docIds];
    status[category] = {
      documentCount: ids.length,
      documents: []
    };
    
    for (const docId of ids) {
      if (docId && !docId.includes('DOC_ID')) {
        const content = await fetchGoogleDoc(docId);
        status[category].documents.push({
          id: docId,
          loaded: content.length > 0,
          characterCount: content.length
        });
      }
    }
  }
  
  res.json(status);
});

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
    console.error(`Error fetching document ${documentId}:`, error);
    return '';
  }
}

// Cache for document content (refreshes every hour)
let documentCache = {};
let cacheTimestamp = 0;

async function getDocumentContent() {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  
  // Refresh cache if older than 1 hour
  if (now - cacheTimestamp > ONE_HOUR || Object.keys(documentCache).length === 0) {
    console.log('Refreshing document cache...');
    
    for (const [category, docId] of Object.entries(DOCUMENT_IDS)) {
      if (docId && docId !== 'YOUR_' + category.toUpperCase() + '_DOC_ID') {
        documentCache[category] = await fetchGoogleDoc(docId);
      }
    }
    
    cacheTimestamp = now;
  }
  
  return documentCache;
}

// AI Coach endpoint with Google Docs integration
app.post('/api/ai-coach', async (req, res) => {
  try {
    const { message, context } = req.body;
    
    // Fetch latest document content
    const documents = await getDocumentContent();
    
    // Create comprehensive system prompt with document content
    const systemPrompt = `You are an expert life coach using the Five Pillars framework. You have access to comprehensive knowledge from the following documents:

FINANCIAL SUCCESS PRINCIPLES:
${documents.financial || 'No financial document loaded'}

HEALTH & FITNESS PRINCIPLES:
${documents.health || 'No health document loaded'}

RELATIONSHIPS PRINCIPLES:
${documents.relationships || 'No relationships document loaded'}

PERSONAL GROWTH PRINCIPLES:
${documents.growth || 'No growth document loaded'}

PURPOSE & JOY PRINCIPLES:
${documents.purpose || 'No purpose document loaded'}

E-COMMERCE STRATEGIES:
${documents.ecommerce || 'No e-commerce document loaded'}

Current user data:
- Financial Success: ${context.pillars[0].value}% (Goal: ${context.pillars[0].goal}%)
- Health & Fitness: ${context.pillars[1].value}% (Goal: ${context.pillars[1].goal}%)
- Relationships: ${context.pillars[2].value}% (Goal: ${context.pillars[2].goal}%)
- Personal Growth: ${context.pillars[3].value}% (Goal: ${context.pillars[3].goal}%)
- Purpose & Joy: ${context.pillars[4].value}% (Goal: ${context.pillars[4].goal}%)
- Overall Balance: ${context.overallScore}%
- Lowest Pillar: ${context.lowestPillar.name} at ${context.lowestPillar.value}%

Instructions:
1. Reference specific principles from the documents when giving advice
2. Synthesize information across different pillars when relevant
3. Provide actionable steps based on their current scores
4. Connect strategies from different documents to create holistic advice
5. If asked to summarize, provide clear, structured summaries
6. Be encouraging but direct, using exact principles from the documents`;

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
      error: 'Failed to get AI response' 
    });
  }
});

// Endpoint to check which documents are loaded
app.get('/api/documents-status', async (req, res) => {
  const documents = await getDocumentContent();
  const status = {};
  
  for (const [category, content] of Object.entries(documents)) {
    status[category] = {
      loaded: content.length > 0,
      characterCount: content.length
    };
  }
  
  res.json(status);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
