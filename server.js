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

// Document IDs
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

// Function to summarize long documents
async function summarizeDocument(text, category) {
  if (text.length < 3000) return text; // Return as-is if short enough
  
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `Extract and summarize the KEY actionable principles from this ${category} document. Focus on specific strategies, exact methods, tools mentioned, and important numbers. Keep the most important details.`
        },
        {
          role: "user",
          content: text.substring(0, 10000) // Use first 10k chars for summary
        }
      ],
      temperature: 0.3,
      max_tokens: 1000
    });
    
    return completion.choices[0].message.content;
  } catch (error) {
    console.error('Error summarizing document:', error);
    // Fallback: return truncated version
    return text.substring(0, 3000) + '\n\n[Document truncated due to length...]';
  }
}

// Cache for document content
let documentCache = {};
let documentSummaries = {};
let cacheTimestamp = 0;

async function getDocumentContent() {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  
  if (now - cacheTimestamp > ONE_HOUR || Object.keys(documentCache).length === 0) {
    console.log('Refreshing document cache...');
    
    // Initialize all categories
    const allCategories = ['financial', 'health', 'relationships', 'growth', 'purpose', 'ecommerce'];
    allCategories.forEach(cat => {
      documentCache[cat] = '';
      documentSummaries[cat] = '';
    });
    
    // Load and process documents
    for (const [category, docIds] of Object.entries(DOCUMENT_IDS)) {
      const ids = Array.isArray(docIds) ? docIds : [docIds];
      
      for (const docId of ids) {
        console.log(`Fetching ${category} document: ${docId}`);
        const content = await fetchGoogleDoc(docId);
        
        if (content) {
          // Store full content
          documentCache[category] += content;
          
          // Create summary for AI context
          console.log(`Creating summary for ${category} (${content.length} chars)`);
          const summary = await summarizeDocument(content, category);
          documentSummaries[category] += `\n\n--- ${category.toUpperCase()} PRINCIPLES ---\n${summary}`;
        }
      }
    }
    
    cacheTimestamp = now;
  }
  
  return { full: documentCache, summaries: documentSummaries };
}

// Search function for specific queries
async function searchDocuments(query, category = null) {
  const { full } = await getDocumentContent();
  const results = [];
  
  const categories = category ? [category] : Object.keys(full);
  
  for (const cat of categories) {
    const content = full[cat];
    if (!content) continue;
    
    // Simple search - find paragraphs containing the query
    const paragraphs = content.split('\n\n');
    const matches = paragraphs.filter(p => 
      p.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 3); // Top 3 matches
    
    if (matches.length > 0) {
      results.push({
        category: cat,
        matches: matches
      });
    }
  }
  
  return results;
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'Life Tracker AI Backend is running!' });
});

// AI Coach endpoint with smart document handling
app.post('/api/ai-coach', async (req, res) => {
  try {
    const { message, context } = req.body;
    
    // Get document summaries (not full text)
    const { summaries } = await getDocumentContent();
    
    // Search for specific content if the query seems specific
    let searchResults = '';
    const searchTerms = ['how to', 'what is', 'specific', 'exactly', 'step by step', 'method', 'strategy'];
    
    if (searchTerms.some(term => message.toLowerCase().includes(term))) {
      const results = await searchDocuments(message);
      if (results.length > 0) {
        searchResults = '\n\nSPECIFIC MATCHES FROM DOCUMENTS:\n' + 
          results.map(r => `${r.category}: ${r.matches.join(' ... ')}`).join('\n\n');
      }
    }
    
    const systemPrompt = `You are a direct, no-nonsense life coach with access to document summaries and specific search results.

DOCUMENT SUMMARIES:
${summaries.financial || 'No financial documents loaded'}
${summaries.purpose || 'No purpose document loaded'}

${searchResults}

USER'S CURRENT STATUS:
- Financial Success: ${context.pillars[0].value}% (Goal: ${context.pillars[0].goal}%)
- Health & Fitness: ${context.pillars[1].value}% (Goal: ${context.pillars[1].goal}%)
- Relationships: ${context.pillars[2].value}% (Goal: ${context.pillars[2].goal}%)
- Personal Growth: ${context.pillars[3].value}% (Goal: ${context.pillars[3].goal}%)
- Purpose & Joy: ${context.pillars[4].value}% (Goal: ${context.pillars[4].goal}%)
- Overall Balance: ${context.overallScore}%
- Weakest Area: ${context.lowestPillar.name} at ${context.lowestPillar.value}%

INSTRUCTIONS:
1. Use the summaries and search results to provide specific advice
2. If you need more detail on a topic, tell the user to ask a more specific question
3. Reference exact strategies and principles from the summaries
4. Be direct and actionable

Keep responses focused and under 500 words.`;

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

// Endpoint to check document status
app.get('/api/documents-status', async (req, res) => {
  const { full, summaries } = await getDocumentContent();
  const status = {};
  
  for (const category of ['financial', 'purpose', 'health', 'relationships', 'growth']) {
    status[category] = {
      loaded: full[category] && full[category].length > 0,
      documentCount: DOCUMENT_IDS[category] ? DOCUMENT_IDS[category].length : 0,
      fullLength: full[category] ? full[category].length : 0,
      summaryLength: summaries[category] ? summaries[category].length : 0
    };
  }
  
  res.json(status);
});

// Endpoint for direct document search
app.post('/api/search-documents', async (req, res) => {
  const { query, category } = req.body;
  const results = await searchDocuments(query, category);
  res.json({ results });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Initializing document cache...');
  getDocumentContent().then(() => {
    console.log('Document cache initialized');
  });
});
