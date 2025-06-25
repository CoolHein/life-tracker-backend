// Update the AI Coach endpoint in your server.js

app.post('/api/ai-coach', async (req, res) => {
  try {
    const { message, context } = req.body;
    
    // Get document summaries
    const { summaries, full } = await getDocumentContent();
    
    // Enhanced search for step-by-step content
    let searchResults = '';
    
    // Check if user is asking for guides, steps, or specific methods
    const guideKeywords = ['step by step', 'guide', 'how to', 'how do i', 'steps', 'process', 'method', 'blueprint'];
    const isAskingForGuide = guideKeywords.some(keyword => message.toLowerCase().includes(keyword));
    
    if (isAskingForGuide || message.toLowerCase().includes('dropshipping')) {
      // Search for numbered lists and structured content
      const results = await searchDocuments(message);
      
      // Also look for numbered sections in documents
      for (const [category, content] of Object.entries(full)) {
        if (content) {
          // Find numbered lists (1., 2., etc.)
          const numberedSections = content.match(/\d\.\s[^.]+[\s\S]*?(?=\d\.\s|$)/g);
          if (numberedSections) {
            searchResults += `\n\nSTRUCTURED GUIDE FROM ${category.toUpperCase()}:\n`;
            searchResults += numberedSections.slice(0, 10).join('\n');
          }
        }
      }
    }
    
    const systemPrompt = `You are a direct AI coach. When users ask for guides or step-by-step instructions, you MUST use the EXACT structure from the documents.

IMPORTANT: If the documents contain a numbered guide or blueprint, reproduce it EXACTLY with all the specific details, tools, percentages, and methods mentioned.

DOCUMENT CONTENT:
${summaries.financial || ''}
${summaries.purpose || ''}

${searchResults}

USER STATUS:
- Financial: ${context.pillars[0].value}%
- Health: ${context.pillars[1].value}%
- Relationships: ${context.pillars[2].value}%
- Growth: ${context.pillars[3].value}%
- Purpose: ${context.pillars[4].value}%

STRICT RULES:
1. If documents contain a step-by-step guide, USE IT EXACTLY - don't create your own
2. Include ALL specific details: percentages (65%+ margins), tools (Dropship.io, TikTok burner), methods (ABO testing)
3. For dropshipping questions, use "The E-Commerce Success Blueprint" structure if available
4. Quote exact strategies, not generic advice
5. If asking for a guide and one exists in documents, provide it in FULL

NEVER give generic business advice when specific strategies exist in the documents.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      temperature: 0.3, // Lower temperature for more accurate reproduction
      max_tokens: 800  // Increased for full guides
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
