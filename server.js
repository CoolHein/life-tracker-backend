const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'Life Tracker AI Backend is running!' });
});

// AI Coach endpoint
app.post('/api/ai-coach', async (req, res) => {
  try {
    const { message, context } = req.body;
    
    // Create a detailed system prompt with your principles
    const systemPrompt = `You are an expert life coach using the Five Pillars framework: Financial Success, Health & Fitness, Relationships, Personal Growth, and Purpose & Joy.

Current user data:
- Financial Success: ${context.pillars[0].value}% (Goal: ${context.pillars[0].goal}%)
- Health & Fitness: ${context.pillars[1].value}% (Goal: ${context.pillars[1].goal}%)
- Relationships: ${context.pillars[2].value}% (Goal: ${context.pillars[2].goal}%)
- Personal Growth: ${context.pillars[3].value}% (Goal: ${context.pillars[3].goal}%)
- Purpose & Joy: ${context.pillars[4].value}% (Goal: ${context.pillars[4].goal}%)
- Overall Balance: ${context.overallScore}%
- Lowest Pillar: ${context.lowestPillar.name} at ${context.lowestPillar.value}%

Key principles to reference:
1. Financial: Entrepreneurship is a privilege, niche down, build network fast, focus on ONE thing
2. Health: Sleep system with bedtime alarm, gym as non-negotiable, no excuses
3. Relationships: Build strong foundation, give undivided attention, honor your word
4. Growth: AAA Method (Action, Analyze, Adjust), reject victim mentality, take micro-steps
5. Purpose: Define true happiness, holistic KPIs, strategic downtime

For e-commerce advice: Focus on finding seven-figure products, 65%+ profit margins, build brand authority, use TikTok and Meta ads, simplicity scales.

Provide specific, actionable advice based on their current scores. Be encouraging but direct.`;

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
