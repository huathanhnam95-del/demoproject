const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { YoutubeTranscript } = require('youtube-transcript');

const app = express();
const PORT = process.env.PORT || 8443;

// Enable CORS for all routes
app.use(cors());

// Parse JSON bodies
app.use(express.json());

// Serve static files (HTML, CSS, JS, etc.)
app.use(express.static('.'));

// API endpoint to fetch YouTube transcript
app.get('/api/transcript', async (req, res) => {
  try {
    const videoId = req.query.videoId;
    
    if (!videoId) {
      return res.status(400).json({ 
        error: 'Missing videoId parameter',
        message: 'Please provide a videoId query parameter (e.g., /api/transcript?videoId=VIDEO_ID)'
      });
    }

    console.log(`Fetching transcript for video: ${videoId}`);

    // Fetch transcript using youtube-transcript library
    const transcriptData = await YoutubeTranscript.fetchTranscript(videoId);
    
    // Transform the data to include start, end, and text
    const captions = transcriptData.map(item => ({
      start: item.offset / 1000, // Convert milliseconds to seconds
      end: (item.offset + item.duration) / 1000,
      text: item.text
    }));

    console.log(`Successfully fetched ${captions.length} captions for video: ${videoId}`);

    res.json({
      success: true,
      videoId: videoId,
      captions: captions,
      count: captions.length
    });

  } catch (error) {
    console.error('Error fetching transcript:', error.message);
    
    // Handle specific error cases
    if (error.message.includes('Transcript is disabled')) {
      return res.status(404).json({
        success: false,
        error: 'Transcript not available',
        message: 'This video does not have captions enabled.'
      });
    }
    
    if (error.message.includes('Could not retrieve a transcript')) {
      return res.status(404).json({
        success: false,
        error: 'Transcript not found',
        message: 'Could not retrieve transcript for this video. The video may not have captions available.'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// API endpoint to analyze sentences and extract meaningful phrases
app.post('/api/analyze-phrases', async (req, res) => {
  try {
    const { sentences, phraseLength } = req.body;
    
    if (!sentences || !Array.isArray(sentences)) {
      return res.status(400).json({ 
        error: 'Missing sentences parameter',
        message: 'Please provide an array of sentences in the request body'
      });
    }
    
    if (!phraseLength || (phraseLength !== 2 && phraseLength !== 3)) {
      return res.status(400).json({ 
        error: 'Invalid phraseLength',
        message: 'phraseLength must be 2 or 3'
      });
    }

    console.log(`Analyzing ${sentences.length} sentences for ${phraseLength}-word phrases`);

    // Use OpenAI API to analyze phrases
    // Note: You'll need to set OPENAI_API_KEY environment variable
    let OpenAI;
    try {
      OpenAI = require('openai');
    } catch (e) {
      console.warn('OpenAI package not installed. Run: npm install openai');
      return res.json({
        success: true,
        phrases: analyzePhrasesFallback(sentences, phraseLength),
        fallback: true
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      console.warn('OPENAI_API_KEY not set, using fallback analysis');
      // Fallback to rule-based analysis if no API key
      return res.json({
        success: true,
        phrases: analyzePhrasesFallback(sentences, phraseLength),
        fallback: true
      });
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const prompt = `You are a linguistic parser. Analyze the following sentences and extract ${phraseLength}-word phrases using proper grammatical chunking (like spaCy or a dependency parser would).

CRITICAL REQUIREMENTS:
1. You MUST return AT LEAST 5 valid phrases per sentence. If a sentence has fewer than 5 perfect phrases, include the best available candidates.
2. DO NOT use a sliding window - parse the sentence grammatically first.
3. Only return complete grammatical chunks that preserve semantic boundaries.

VALID PHRASE TYPES (${phraseLength}-word only):
• Complete Noun Phrases (NP): "dense forests", "nocturnal predator", "willow oak trees"
• Adjective + Noun units: "small mammals", "urban population", "old-growth forests"
• Prepositional Phrases (PP): "in dense forests", "on small mammals" (only if ${phraseLength} words)
• Complete Verb Phrases (VP): "has emerged as" (only if ${phraseLength} words and complete)

STRICT RULES - DO NOT return phrases that:
• End in function words: "the", "a", "an", "they", "that", "this", "these", "those", "it", "he", "she", "we", "you"
• Break noun phrases in half: "a very adaptable" (missing the noun) → INVALID
• Break verb phrases in half: "has emerged" when it should be "has emerged as" → INVALID if ${phraseLength} is 3
• Join parts of different phrases: "up quite an" → INVALID
• Are random consecutive words: "the effects they" → INVALID
• Cross punctuation boundaries (commas, semicolons)

VALID EXAMPLES from owl text:
• "dense forests" ✓
• "small mammals" ✓
• "nocturnal predator" ✓
• "old-growth forests" ✓
• "urban population" ✓
• "willow oak trees" ✓

INVALID EXAMPLES (DO NOT return):
• "the effects they" ✗ (ends in pronoun)
• "a very adaptable" ✗ (incomplete, missing noun)
• "up quite an" ✗ (broken phrase)
• "that line the" ✗ (ends in article)

For each sentence, parse it grammatically and return a JSON array of ${phraseLength}-word phrases that are complete semantic units. Each phrase must be the EXACT words as they appear in the sentence, unmodified.

Sentences:
${sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Return ONLY a JSON array of arrays, where each inner array contains AT LEAST 5 valid ${phraseLength}-word phrases for that sentence. Example format:
[
  ["dense forests", "small mammals", "nocturnal predator", "urban population", "willow oak trees"],
  ["phrase one", "phrase two", "phrase three", "phrase four", "phrase five"],
  ["phrase six", "phrase seven", "phrase eight", "phrase nine", "phrase ten"]
]`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a linguistic analysis tool. Return only valid JSON arrays, no explanations.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 2000
    });

    const responseText = completion.choices[0].message.content.trim();
    // Extract JSON from response (handle markdown code blocks if present)
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    let phrases = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    // Validate and ensure at least 5 phrases per sentence
    phrases = phrases.map((sentencePhrases, idx) => {
      if (!Array.isArray(sentencePhrases)) {
        sentencePhrases = [];
      }
      
      // Filter out invalid phrases (ending in function words)
      const functionWordEndings = ['the', 'a', 'an', 'they', 'that', 'this', 'these', 'those', 'it', 'he', 'she', 'we', 'you', 'i'];
      sentencePhrases = sentencePhrases.filter(phrase => {
        const words = phrase.trim().toLowerCase().split(/\s+/);
        const lastWord = words[words.length - 1].replace(/[.,!?;:]/g, '');
        return !functionWordEndings.includes(lastWord);
      });
      
      // If we have fewer than 5 phrases, use fallback to generate more
      if (sentencePhrases.length < 5) {
        console.warn(`Sentence ${idx + 1} has only ${sentencePhrases.length} phrases, using fallback`);
        const fallbackPhrases = generateFallbackPhrases(sentences[idx], phraseLength);
        // Combine LLM phrases with fallback, remove duplicates
        const allPhrases = [...new Set([...sentencePhrases, ...fallbackPhrases])];
        // Filter again to remove function word endings
        const filtered = allPhrases.filter(phrase => {
          const words = phrase.trim().toLowerCase().split(/\s+/);
          const lastWord = words[words.length - 1].replace(/[.,!?;:]/g, '');
          return !functionWordEndings.includes(lastWord);
        });
        return filtered.slice(0, Math.max(5, filtered.length));
      }
      
      return sentencePhrases;
    });

    console.log(`Extracted phrases for ${sentences.length} sentences (ensured at least 5 per sentence)`);

    res.json({
      success: true,
      phrases: phrases
    });

  } catch (error) {
    console.error('Error analyzing phrases:', error.message);
    
    // Fallback to rule-based analysis on error
    try {
      const { sentences, phraseLength } = req.body;
      res.json({
        success: true,
        phrases: analyzePhrasesFallback(sentences, phraseLength),
        fallback: true
      });
    } catch (fallbackError) {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }
});

// Generate fallback phrases using rule-based approach (better heuristics)
function generateFallbackPhrases(sentence, phraseLength) {
  const words = sentence.trim().split(/\s+/);
  const phrases = [];
  const functionWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'from', 'up', 'about', 'into', 'through', 'during', 'including', 'until', 'against', 'among',
    'throughout', 'despite', 'towards', 'upon', 'concerning', 'is', 'are', 'was', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'will',
    'would', 'could', 'should', 'may', 'might', 'can', 'must', 'shall', 'this', 'that', 'these',
    'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
    'my', 'your', 'his', 'her', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs']);
  const functionWordEndings = ['the', 'a', 'an', 'they', 'that', 'this', 'these', 'those', 'it', 'he', 'she', 'we', 'you', 'i'];
  
  if (words.length < phraseLength) {
    return [];
  }
  
  // Better heuristics: look for patterns that form meaningful phrases
  for (let i = 0; i <= words.length - phraseLength; i++) {
    const phraseWords = words.slice(i, i + phraseLength);
    const phraseText = phraseWords.join(' ');
    
    // Skip if has punctuation between words
    let hasPunctuationBetween = false;
    for (let j = 0; j < phraseLength - 1; j++) {
      const word = phraseWords[j];
      const wordWithPunct = word.replace(/[.,!?;:]/g, '');
      if (word.length > wordWithPunct.length) {
        const punct = word.slice(wordWithPunct.length);
        if (punct.includes(',') || punct.includes(';')) {
          hasPunctuationBetween = true;
          break;
        }
      }
    }
    
    if (hasPunctuationBetween) {
      continue;
    }
    
    // Check if phrase ends in function word - reject it
    const lastWord = phraseWords[phraseLength - 1].replace(/[.,!?;:]/g, '').toLowerCase();
    if (functionWordEndings.includes(lastWord)) {
      continue;
    }
    
    // Prefer phrases that:
    // 1. Start with preposition and end with noun
    // 2. Are adjective + noun
    // 3. Are all content words
    const firstWord = phraseWords[0].replace(/[.,!?;:]/g, '').toLowerCase();
    const isPreposition = ['in', 'on', 'at', 'for', 'of', 'with', 'by', 'from', 'to', 'into', 'onto'].includes(firstWord);
    const isDeterminer = ['the', 'a', 'an', 'this', 'that', 'these', 'those', 'other', 'some', 'any', 'all'].includes(firstWord);
    
    // Accept if it starts with preposition/determiner and ends with content word
    if ((isPreposition || isDeterminer) && !functionWords.has(lastWord)) {
      phrases.push(phraseText);
      continue;
    }
    
    // Accept if all words are content words (not function words)
    let allContentWords = true;
    for (const word of phraseWords) {
      const cleanWord = word.replace(/[.,!?;:]/g, '').toLowerCase();
      if (functionWords.has(cleanWord)) {
        allContentWords = false;
        break;
      }
    }
    
    if (allContentWords) {
      phrases.push(phraseText);
    }
  }
  
  return phrases;
}

// Fallback rule-based phrase analysis
function analyzePhrasesFallback(sentences, phraseLength) {
  // Generate at least 5 phrases per sentence using rule-based approach
  return sentences.map(sentence => {
    const phrases = generateFallbackPhrases(sentence, phraseLength);
    // Return at least 5, or all available if less than 5
    return phrases.length >= 5 ? phrases.slice(0, 15) : phrases;
  });
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Fallback: serve index.html for all other routes (for SPA routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
// Check if HTTPS certificates exist for port 8443
const https = require('https');
const http = require('http');

let server;
if (PORT === 8443) {
  // Try to use HTTPS if certificates exist
  if (fs.existsSync('cert.pem') && fs.existsSync('key.pem')) {
    const options = {
      key: fs.readFileSync('key.pem'),
      cert: fs.readFileSync('cert.pem')
    };
    server = https.createServer(options, app);
    server.listen(PORT, () => {
      console.log(`Server running on https://localhost:${PORT}`);
      console.log(`API endpoint: https://localhost:${PORT}/api/transcript?videoId=VIDEO_ID`);
    });
  } else if (fs.existsSync('localhost-key.pem') && fs.existsSync('localhost.pem')) {
    const options = {
      key: fs.readFileSync('localhost-key.pem'),
      cert: fs.readFileSync('localhost.pem')
    };
    server = https.createServer(options, app);
    server.listen(PORT, () => {
      console.log(`Server running on https://localhost:${PORT}`);
      console.log(`API endpoint: https://localhost:${PORT}/api/transcript?videoId=VIDEO_ID`);
    });
  } else {
    // Fallback to HTTP if no certificates
    server = http.createServer(app);
    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`API endpoint: http://localhost:${PORT}/api/transcript?videoId=VIDEO_ID`);
      console.log('Note: Using HTTP. For HTTPS, create SSL certificates.');
    });
  }
} else {
  // For other ports, use HTTP
  server = http.createServer(app);
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`API endpoint: http://localhost:${PORT}/api/transcript?videoId=VIDEO_ID`);
  });
}
