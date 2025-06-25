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

// Function to extract key content
function extractKeyContent(text, maxLength = 4000) {
  // Look for numbered lists and important sections
  const lines = text.split('\n');
  const keyContent = [];
  let currentSection = '';
  
  for (const line of lines) {
    // Capture headers, numbered items, and key phrases
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
          
          // Extract key content for summaries
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

// Search function for specific content
async function searchDocuments(query, category = null) {
  const { full } = await getDocumentContent();
  const results = [];
  const searchTerm = query.toLowerCase();
  
  const categories = category ? [category] : Object.keys(full);
  
  for (const cat of categories) {
    const content = full[cat];
    if (!content) continue;
    
    // Find relevant sections
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

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'Life Tracker AI Backend is running!' });
});

// AI Coach endpoint with improved document handling
app.post('/api/ai-coach', async (req, res) => {
  try {
    const { message, context } = req.body;
    
    // Get document content
    const { summaries, full } = await getDocumentContent();
    
    // Enhanced search for structured content
    let specificContent = '';
    
    // Keywords that trigger detailed search
    const detailKeywords = ['step by step', 'guide', 'how to', 'how do i', 'steps', 'process', 'method', 'blueprint', 'specific', 'exactly'];
    const needsDetail = detailKeywords.some(keyword => message.toLowerCase().includes(keyword));
    
    if (needsDetail) {
      const searchResults = await searchDocuments(message);
      
      // Look for structured content in full documents
      if (message.toLowerCase().includes('dropshipping') || message.toLowerCase().includes('ecommerce')) {
        // Extract the e-commerce blueprint if available
        for (const [category, content] of Object.entries(full)) {
          if (content.includes('E-Commerce Success Blueprint') || content.includes('dropshipping')) {
            const blueprintMatch = content.match(/E-Commerce Success Blueprint[\s\S]*?(?=\n\n[A-Z]|$)/);
            if (blueprintMatch) {
              specificContent = '\n\nEXACT BLUEPRINT FROM DOCUMENTS:\n' + blueprintMatch[0];
              break;
            }
          }
        }
      }
      
      // Add search results
      if (searchResults.length > 0) {
        specificContent += '\n\nSPECIFIC SECTIONS:\n';
        searchResults.forEach(result => {
          specificContent += `\nFrom ${result.category}:\n${result.matches.join('\n---\n')}`;
        });
      }
    }
    
    const systemPrompt = `You are a direct AI coach with access to specific business documents. Your job is to provide EXACT information from the documents, not generic advice.

AVAILABLE CONTENT:
${summaries.financial || 'No financial content'}
${summaries.purpose || 'No purpose content'}

${specificContent}

USER STATUS:
- Financial: ${context.pillars[0].value}%
- Health: ${context.pillars[1].value}%
- Relationships: ${context.pillars[2].value}%
- Growth: ${context.pillars[3].value}%
- Purpose: ${context.pillars[4].value}%

CRITICAL INSTRUCTIONS:
1. When users ask for guides, steps, or methods, use the EXACT structure from documents
2. Include ALL specific details: tools (Dropship.io, TikTok burner, Loox, Klaviyo), percentages (65%+ margins, 30% scaling), methods (ABO testing, Advantage+ Shopping)
3. NEVER create generic advice when specific strategies exist in documents
4. If documents contain numbered steps or blueprints, reproduce them EXACTLY
5. Quote directly from documents whenever possible

User asked: "${message}"
Provide the most specific, document-based answer possible.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      temperature: 0.3,
      max_tokens: 800
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

// Document status endpoint
app.get('/api/documents-status', async (req, res) => {
  const { full, summaries } = await getDocumentContent();
  const status = {};
  
  const categories = ['financial', 'purpose', 'health', 'relationships', 'growth'];
  for (const category of categories) {
    status[category] = {
      loaded: full[category] && full[category].length > 0,
      documentCount: DOCUMENT_IDS[category] ? DOCUMENT_IDS[category].length : 0,
      fullLength: full[category] ? full[category].length : 0,
      summaryLength: summaries[category] ? summaries[category].length : 0
    };
  }
  
  res.json(status);
});

// Search endpoint
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
