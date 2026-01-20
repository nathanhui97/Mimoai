/**
 * Supabase Edge Function: debug_step_failure
 * 
 * Intelligent step failure analysis using AI to:
 * 1. Understand why a step failed
 * 2. Analyze DOM differences between recording and replay
 * 3. Suggest fixes (new selectors, timing adjustments, etc.)
 * 4. Learn patterns for future similar failures
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

interface DebugRequest {
  step: {
    type: string;
    description?: string;
    payload: {
      selector: string;
      elementText?: string;
      elementRole?: string;
      label?: string;
      url: string;
      value?: string;
      elementBounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      context?: {
        formCoordinates?: { label: string };
        buttonContext?: { label: string };
        container?: { text: string };
      };
    };
  };
  failureContext: {
    error: string;
    triedMethods: string[];
    currentUrl: string;
    pageTitle: string;
    candidates: Array<{
      tag: string;
      text: string;
      role?: string;
      selector: string;
      distance?: number;
    }>;
    domContext?: string; // Truncated HTML context
  };
  visualContext?: {
    recordedScreenshot?: string; // Base64
    currentScreenshot?: string; // Base64
    elementSnapshot?: string; // Base64
  };
}

interface DebugResponse {
  analysis: {
    rootCause: 'element_moved' | 'element_removed' | 'timing' | 'dynamic_content' | 'framework_change' | 'selector_fragile' | 'unknown';
    explanation: string;
    confidence: number;
  };
  suggestions: Array<{
    type: 'selector' | 'wait' | 'scroll' | 'workflow' | 'coordinate';
    description: string;
    newValue?: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  bestCandidate?: {
    index: number;
    selector: string;
    confidence: number;
    reasoning: string;
  };
  learnedPattern?: {
    sitePattern: string;
    selectorStrategy: string;
    notes: string;
  };
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }

  try {
    const request: DebugRequest = await req.json();

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    // Build comprehensive debug prompt
    const prompt = buildDebugPrompt(request);

    // Build Gemini API request
    const geminiRequest: any = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.2, // Low temperature for analytical tasks
        topP: 0.8,
        maxOutputTokens: 2048,
      }
    };

    // Add visual context if available
    if (request.visualContext?.currentScreenshot) {
      geminiRequest.contents[0].parts.push({
        inline_data: {
          mime_type: 'image/png',
          data: extractBase64Data(request.visualContext.currentScreenshot)
        }
      });
    }

    if (request.visualContext?.elementSnapshot) {
      geminiRequest.contents[0].parts.push({
        inline_data: {
          mime_type: 'image/jpeg',
          data: extractBase64Data(request.visualContext.elementSnapshot)
        }
      });
    }

    // Call Gemini API
    const geminiResponse = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geminiRequest),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      throw new Error(`Gemini API error: ${geminiResponse.status} - ${errorText}`);
    }

    const geminiData = await geminiResponse.json();
    const response = parseGeminiResponse(geminiData, request);

    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error in debug_step_failure:', error);
    return new Response(
      JSON.stringify({
        analysis: {
          rootCause: 'unknown',
          explanation: error instanceof Error ? error.message : 'Unknown error',
          confidence: 0,
        },
        suggestions: [{
          type: 'wait',
          description: 'Try adding a longer wait before this step',
          newValue: '2000',
          priority: 'medium',
        }],
      }),
      {
        status: 200, // Return 200 with error info instead of 500
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
});

/**
 * Build comprehensive debug prompt
 */
function buildDebugPrompt(request: DebugRequest): string {
  const { step, failureContext } = request;
  
  let prompt = `You are an expert web automation debugger. Analyze this step failure and provide actionable fixes.

## Step Information
- Type: ${step.type}
- Description: ${step.description || 'N/A'}
- Original Selector: ${step.payload.selector}
- Element Text: "${step.payload.elementText || 'N/A'}"
- Element Role: ${step.payload.elementRole || 'N/A'}
- Label: "${step.payload.label || 'N/A'}"
- Original URL: ${step.payload.url}
${step.payload.value ? `- Input Value: "${step.payload.value}"` : ''}
${step.payload.elementBounds ? `- Original Position: (${step.payload.elementBounds.x}, ${step.payload.elementBounds.y})` : ''}

## Failure Context
- Error: ${failureContext.error}
- Current URL: ${failureContext.currentUrl}
- Page Title: ${failureContext.pageTitle}
- Tried Methods: ${failureContext.triedMethods.join(', ')}

## Available Candidates (${failureContext.candidates.length} found)
`;

  // Add candidates
  if (failureContext.candidates.length > 0) {
    failureContext.candidates.forEach((candidate, index) => {
      const distance = candidate.distance !== undefined ? ` [${Math.round(candidate.distance)}px away]` : '';
      prompt += `${index + 1}. <${candidate.tag}> "${candidate.text.substring(0, 50)}" (role: ${candidate.role || 'none'}) - ${candidate.selector}${distance}\n`;
    });
  } else {
    prompt += `No similar elements found on page.\n`;
  }

  // Add DOM context
  if (failureContext.domContext) {
    prompt += `
## DOM Context (truncated)
\`\`\`html
${failureContext.domContext.substring(0, 1000)}
\`\`\`
`;
  }

  // Add visual context note
  if (request.visualContext?.currentScreenshot) {
    prompt += `\n## Visual Context
- Current page screenshot is provided as image
${request.visualContext.elementSnapshot ? '- Original element snapshot is provided as second image' : ''}
`;
  }

  prompt += `
## Your Task
1. Identify the ROOT CAUSE of why this step failed
2. Analyze if any candidate matches the intended element
3. Suggest fixes in order of priority

Respond with JSON in this exact format:
{
  "analysis": {
    "rootCause": "element_moved" | "element_removed" | "timing" | "dynamic_content" | "framework_change" | "selector_fragile" | "unknown",
    "explanation": "Detailed explanation of what went wrong",
    "confidence": 0.0-1.0
  },
  "suggestions": [
    {
      "type": "selector" | "wait" | "scroll" | "workflow" | "coordinate",
      "description": "What to do",
      "newValue": "new selector or wait time etc",
      "priority": "high" | "medium" | "low"
    }
  ],
  "bestCandidate": {
    "index": 0,
    "selector": "new selector",
    "confidence": 0.0-1.0,
    "reasoning": "why this is the best match"
  },
  "learnedPattern": {
    "sitePattern": "e.g., *.salesforce.com",
    "selectorStrategy": "Use data-aura-rendered-by for Salesforce components",
    "notes": "Any patterns noticed about this site"
  }
}

Only include bestCandidate if you're confident one of the candidates matches.
Only include learnedPattern if you notice a site-specific pattern.`;

  return prompt;
}

/**
 * Extract base64 data from data URL
 */
function extractBase64Data(dataUrl: string): string {
  const base64Match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
  return base64Match ? base64Match[1] : dataUrl;
}

/**
 * Parse Gemini response into structured format
 */
function parseGeminiResponse(geminiData: any, request: DebugRequest): DebugResponse {
  try {
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Try to extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Gemini response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    // Validate and build response
    const response: DebugResponse = {
      analysis: {
        rootCause: parsed.analysis?.rootCause || 'unknown',
        explanation: parsed.analysis?.explanation || 'Unable to determine cause',
        confidence: typeof parsed.analysis?.confidence === 'number' ? parsed.analysis.confidence : 0.5,
      },
      suggestions: [],
    };

    // Parse suggestions
    if (Array.isArray(parsed.suggestions)) {
      response.suggestions = parsed.suggestions.map((s: any) => ({
        type: s.type || 'wait',
        description: s.description || 'Unknown suggestion',
        newValue: s.newValue,
        priority: s.priority || 'medium',
      }));
    }

    // Add default suggestions if none provided
    if (response.suggestions.length === 0) {
      response.suggestions = [{
        type: 'wait',
        description: 'Add a wait before this step for dynamic content',
        newValue: '1500',
        priority: 'medium',
      }];
    }

    // Parse best candidate
    if (parsed.bestCandidate && typeof parsed.bestCandidate.index === 'number') {
      const candidateIndex = parsed.bestCandidate.index;
      const candidate = request.failureContext.candidates[candidateIndex];
      
      if (candidate) {
        response.bestCandidate = {
          index: candidateIndex,
          selector: parsed.bestCandidate.selector || candidate.selector,
          confidence: parsed.bestCandidate.confidence || 0.6,
          reasoning: parsed.bestCandidate.reasoning || 'AI selected this candidate',
        };
      }
    }

    // Parse learned pattern
    if (parsed.learnedPattern && parsed.learnedPattern.sitePattern) {
      response.learnedPattern = {
        sitePattern: parsed.learnedPattern.sitePattern,
        selectorStrategy: parsed.learnedPattern.selectorStrategy || '',
        notes: parsed.learnedPattern.notes || '',
      };
    }

    return response;
  } catch (error) {
    console.error('Error parsing Gemini response:', error);
    
    // Return default response
    return {
      analysis: {
        rootCause: 'unknown',
        explanation: 'Failed to parse AI analysis',
        confidence: 0,
      },
      suggestions: [{
        type: 'wait',
        description: 'Try adding a longer wait before this step',
        newValue: '2000',
        priority: 'medium',
      }],
    };
  }
}



