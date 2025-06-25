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

// Document IDs - Multiple docs per category supported
const DOCUMENT_IDS = {
  financial: [
    '13ng_EnHnFt-vJ60RV7ek9msWdwlLwo60QGd6t36UqCM', // Main financial principles
    '11VKfDVcShlSQjC2RsQSLBbFn1bI7W0h9tw5v5FYVP60', // E-commerce strategies
    'DOC_ID_3'  // Your investment guide doc (placeholder)
  ],
  health: [
    'DOC_ID_4', // Physical fitness doc (placeholder)
    'DOC_ID_5'  // Mental health & stress management doc (placeholder)
  ],
  relationships: [
    'DOC_ID_6', // Family relationships doc (placeholder)
    'DOC_ID_7', // Professional networking doc (placeholder)
    'DOC_ID_8'  // Social connections doc (placeholder)
  ],
  growth: [
    'DOC_ID_9',  // Learning strategies doc (placeholder)
    'DOC_ID_10'  // Mindset principles doc (placeholder)
  ],
  purpose: [
    '1So9QI--hsQUj2FEKQoXcrjGLIo6zZzT02Wrm8MexP0E'  // Purpose and fulfillment doc
  ],
  ecommerce: [
    'DOC_ID_12', // Dropshipping guide (placeholder)
    'DOC_ID_13', // Website optimization doc (placeholder)
    'DOC_ID_14'  // Marketing strategies doc (placeholder)
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
    
    for (const [category, docIds] of Object.entries(DOCUMENT_IDS)) {
      documentCache[category] = '';
      
      // Handle both single doc ID (string) and multiple (array)
      const ids = Array.isArray(docIds) ? docIds : [docIds];
      
      for (const docId of ids) {
        // Skip placeholders
        if (docId && !docId.includes('DOC_ID')) {
          console.log(`Fetching ${category} document: ${docId}`);
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

KNOWLEDGE BASE DOCUMENTS:

FINANCIAL SUCCESS:
${documents.financial || 'No financial document loaded'}

HEALTH & FITNESS:
${documents.health || 'No health document loaded'}

RELATIONSHIPS:
${documents.relationships || 'No relationships document loaded'}

PERSONAL GROWTH:
${documents.growth || 'No growth document loaded'}

PURPOSE & JOY:
${documents.purpose || 'No purpose document loaded'}

E-COMMERCE & BUSINESS:
${documents.ecommerce || 'No e-commerce document loaded'}

USER'S CURRENT STATUS:
- Financial Success: ${context.pillars[0].value}% (Goal: ${context.pillars[0].goal}%)
- Health & Fitness: ${context.pillars[1].value}% (Goal: ${context.pillars[1].goal}%)
- Relationships: ${context.pillars[2].value}% (Goal: ${context.pillars[2].goal}%)
- Personal Growth: ${context.pillars[3].value}% (Goal: ${context.pillars[3].goal}%)
- Purpose & Joy: ${context.pillars[4].value}% (Goal: ${context.pillars[4].goal}%)
- Overall Balance: ${context.overallScore}%
- Weakest Area: ${context.lowestPillar.name} at ${context.lowestPillar.value}%

STRICT INSTRUCTIONS:

1. ALWAYS cite specific information from the documents. Use exact quotes when relevant.

2. For business/e-commerce questions:
   - Pull EXACT strategies from the e-commerce documents
   - Give specific numbers, tools, and platforms mentioned
   - Provide actionable steps, not general advice

3. For step-by-step guides:
   - Number each step clearly
   - Include specific tools, metrics, or actions from the documents
   - Add exact details (timeframes, percentages, tools mentioned in docs)

4. When connecting pillars:
   - Only connect them if the documents explicitly show a relationship
   - Use the user's actual scores to prioritize advice
   - Keep connections brief and relevant

5. Response style:
   - Start with the most relevant document information
   - Be direct - no fluff or generic motivation
   - Include specific principles with their exact wording from docs
   - If documents don't cover something, say so

6. For implementation questions:
   - Give exact methods from the documents
   - Include specific tools, apps, or platforms mentioned
   - Provide measurable actions, not vague suggestions

NEVER give generic advice. ALWAYS ground responses in the document content. If the user asks about something not in the documents, tell them exactly what IS available instead.`;

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
  const status = {};
  
  for (const [category, content] of Object.entries(documents)) {
    status[category] = {
      loaded: content.length > 0,
      characterCount: content.length,
      preview: content.substring(0, 100) + '...'
    };
  }
  
  res.json(status);
});

// Debug endpoint to see what content is actually loaded
app.get('/api/debug-documents', async (req, res) => {
  const documents = await getDocumentContent();
  const preview = {};
  
  for (const [category, content] of Object.entries(documents)) {
    preview[category] = {
      loaded: content.length > 0,
      firstWords: content.substring(0, 200) + '...',
      totalLength: content.length
    };
  }
  
  res.json(preview);
});

// Endpoint to manually refresh document cache
app.post('/api/refresh-documents', async (req, res) => {
  cacheTimestamp = 0; // Force cache refresh
  const documents = await getDocumentContent();
  
  res.json({ 
    success: true, 
    message: 'Document cache refreshed',
    documentsLoaded: Object.keys(documents).filter(key => documents[key].length > 0)
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Initializing document cache...');
  getDocumentContent().then(() => {
    console.log('Document cache initialized');
  });
});
