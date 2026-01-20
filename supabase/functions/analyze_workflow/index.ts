/**
 * Supabase Edge Function: analyze_workflow
 *
 * Analyzes recorded workflows using AI to produce rich execution guidance.
 * Called by post-recording-analyzer.ts after recording stops.
 *
 * Input: { prompt: string } - The analysis prompt with workflow data
 * Output: { analysis: string } - JSON string with WorkflowAnalysis structure
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getSystemPromptForTask } from '../_shared/system-prompt.ts';

const VERSION = 'v1.0.0';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

console.log('analyze_workflow Edge Function', VERSION, 'starting...');

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Max-Age': '86400',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    console.log('analyze_workflow', VERSION, 'received request');

    const { prompt } = await req.json();

    if (!prompt) {
      throw new Error('Missing prompt in request body');
    }

    console.log('[analyze_workflow] Prompt length:', prompt.length);

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    // Add system context to the prompt
    const systemContext = getSystemPromptForTask('analyze_workflow');
    const fullPrompt = `${systemContext}\n\n${prompt}`;
    console.log('[analyze_workflow] Full prompt length with system context:', fullPrompt.length);

    // Build Gemini request
    const geminiRequest = {
      contents: [{
        role: 'user',
        parts: [{ text: fullPrompt }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,  // Large output for comprehensive analysis
        responseMimeType: 'application/json',  // Request JSON output
      },
    };

    // Call Gemini API
    console.log('[analyze_workflow] Calling Gemini API...');
    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geminiRequest),
    });

    if (!geminiResponse.ok) {
      const error = await geminiResponse.text();
      console.error('[analyze_workflow] Gemini API error:', error);
      throw new Error(`Gemini API error: ${geminiResponse.status}`);
    }

    const geminiResult = await geminiResponse.json();
    console.log('[analyze_workflow] Gemini response received');

    // Extract the analysis text from the response
    const analysisText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!analysisText) {
      console.error('[analyze_workflow] Empty response from Gemini');
      throw new Error('Empty response from Gemini API');
    }

    console.log('[analyze_workflow] Analysis length:', analysisText.length);
    console.log('[analyze_workflow] First 500 chars:', analysisText.substring(0, 500));

    // Validate that it's valid JSON
    try {
      JSON.parse(analysisText);
      console.log('[analyze_workflow] Response is valid JSON');
    } catch (parseError) {
      console.warn('[analyze_workflow] Response may not be valid JSON, client will handle extraction');
    }

    return new Response(JSON.stringify({ analysis: analysisText }), {
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  } catch (error) {
    console.error('[analyze_workflow] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  }
});
