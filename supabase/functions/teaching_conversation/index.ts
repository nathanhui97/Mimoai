/**
 * Supabase Edge Function: teaching_conversation
 * Handles both pre-recording intent capture and post-recording confirmation
 * Uses Gemini API for conversational teaching interaction
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
// Using Gemini 3.0 Flash for text-based reasoning
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

// ============================================================================
// Types
// ============================================================================

interface TeachingIntent {
  userDescription: string;
  expectedAction: {
    verb: string;
    object: string;
    isGeneric: boolean;
  };
  expectedVariables: string[];
  capturedAt: number;
}

interface LearnedSkill {
  originalIntent: TeachingIntent;
  whatItDoes: string;
  canonicalAction: {
    verb: string;
    verbSynonyms: string[];
    object: string;
    objectSynonyms: string[];
  };
  exampleQueries: string[];
  extractableVariables: Array<{
    name: string;
    patterns: string[];
    examples: string[];
  }>;
  constants: Array<{
    name: string;
    value: string;
    overridable: boolean;
    overridePatterns?: string[];
  }>;
  domain: {
    application: string;
    category: string;
  };
  teachingMetadata: {
    taughtAt: number;
    questionsAsked: number;
    userConfirmed: boolean;
  };
}

interface WorkflowStep {
  type: string;
  description?: string;
  hasDropdown?: boolean;
  hasTextInput?: boolean;
  inputValue?: string;
  selectedOption?: string;
  url: string;
}

interface PreRecordingRequest {
  mode: 'pre_recording';
  userMessage: string;
}

interface PostRecordingRequest {
  mode: 'post_recording';
  teachingIntent: TeachingIntent;
  workflow: {
    name: string;
    stepCount: number;
    steps: WorkflowStep[];
  };
  previousAnswers?: Array<{ questionId: string; answer: string }>;
}

type TeachingRequest = PreRecordingRequest | PostRecordingRequest;

interface PreRecordingResponse {
  intent: TeachingIntent;
  aiResponse: string;
  suggestedName: string;
}

interface PostRecordingQuestion {
  id: string;
  type: 'variable' | 'constant' | 'trigger' | 'confirmation';
  question: string;
  quickOptions?: string[];
  allowFreeText: boolean;
}

interface PostRecordingResponse {
  question?: PostRecordingQuestion;
  isComplete: boolean;
  learnedSkill?: LearnedSkill;
  aiResponse: string;
}

// ============================================================================
// Main Handler
// ============================================================================

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
    const payload: TeachingRequest = await req.json();

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    let result: PreRecordingResponse | PostRecordingResponse;

    if (payload.mode === 'pre_recording') {
      result = await handlePreRecording(payload);
    } else if (payload.mode === 'post_recording') {
      result = await handlePostRecording(payload);
    } else {
      throw new Error('Invalid mode. Must be "pre_recording" or "post_recording"');
    }

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error in teaching_conversation:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        aiResponse: 'Sorry, I had trouble understanding that. Could you try rephrasing?',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
});

// ============================================================================
// Pre-Recording Handler
// ============================================================================

async function handlePreRecording(payload: PreRecordingRequest): Promise<PreRecordingResponse> {
  const { userMessage } = payload;

  const prompt = buildPreRecordingPrompt(userMessage);
  const geminiResponse = await callGemini(prompt);
  const parsed = parsePreRecordingResponse(geminiResponse, userMessage);

  return parsed;
}

function buildPreRecordingPrompt(userMessage: string): string {
  return `You are an AI assistant learning from a user. The user is about to teach you a new task by recording their actions in a browser.

USER SAID: "${userMessage}"

Analyze what they want to teach you and respond in JSON format:

{
  "understanding": {
    "verb": "<main action verb: download, create, update, delete, search, navigate, etc.>",
    "object": "<what they're acting on: dashboard, account, report, form, etc.>",
    "isGeneric": <true if they said "a/any X" meaning it should work for any X, false if specific>,
    "expectedVariables": ["<variable names you expect to see, e.g., 'dashboard name', 'account name'>"]
  },
  "suggestedName": "<short name for this task, e.g., 'Download Dashboard'>",
  "response": "<friendly response acknowledging what you'll watch for, 1-2 sentences>",
  "watchFor": ["<things to pay attention to during recording>"]
}

GUIDELINES:
- If user says "how to download A dashboard" or "download ANY report", isGeneric = true
- If user says "download THIS dashboard" or "the Q4 report", isGeneric = false  
- Extract likely variables (things that will change each time)
- Keep response friendly and conversational
- suggestedName should be 2-4 words, action-oriented

EXAMPLES:
- "how to download a dashboard" → verb: "download", object: "dashboard", isGeneric: true, expectedVariables: ["dashboard name"]
- "create a new account in salesforce" → verb: "create", object: "account", isGeneric: true, expectedVariables: ["account name"]
- "update the Q4 budget report" → verb: "update", object: "report", isGeneric: false, expectedVariables: []`;
}

function parsePreRecordingResponse(geminiResponse: string, userMessage: string): PreRecordingResponse {
  try {
    const jsonMatch = geminiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const intent: TeachingIntent = {
      userDescription: userMessage,
      expectedAction: {
        verb: parsed.understanding?.verb || 'perform',
        object: parsed.understanding?.object || 'task',
        isGeneric: parsed.understanding?.isGeneric ?? true,
      },
      expectedVariables: parsed.understanding?.expectedVariables || [],
      capturedAt: Date.now(),
    };

    return {
      intent,
      aiResponse: parsed.response || `Got it! I'll watch how you ${intent.expectedAction.verb} ${intent.expectedAction.object}. Start whenever you're ready!`,
      suggestedName: parsed.suggestedName || `${capitalize(intent.expectedAction.verb)} ${capitalize(intent.expectedAction.object)}`,
    };
  } catch (error) {
    console.error('Error parsing pre-recording response:', error);
    // Fallback response
    return {
      intent: {
        userDescription: userMessage,
        expectedAction: {
          verb: 'perform',
          object: 'task',
          isGeneric: true,
        },
        expectedVariables: [],
        capturedAt: Date.now(),
      },
      aiResponse: `Got it! I'll watch what you do. Start whenever you're ready!`,
      suggestedName: 'New Task',
    };
  }
}

// ============================================================================
// Post-Recording Handler
// ============================================================================

async function handlePostRecording(payload: PostRecordingRequest): Promise<PostRecordingResponse> {
  const { teachingIntent, workflow, previousAnswers } = payload;

  // Determine what stage of the conversation we're at
  const answeredQuestionIds = new Set(previousAnswers?.map(a => a.questionId) || []);
  
  // Generate the next question or final skill
  const prompt = buildPostRecordingPrompt(teachingIntent, workflow, previousAnswers || []);
  const geminiResponse = await callGemini(prompt);
  const parsed = parsePostRecordingResponse(geminiResponse, teachingIntent, workflow, previousAnswers || []);

  return parsed;
}

function buildPostRecordingPrompt(
  teachingIntent: TeachingIntent,
  workflow: { name: string; stepCount: number; steps: WorkflowStep[] },
  previousAnswers: Array<{ questionId: string; answer: string }>
): string {
  const answeredIds = previousAnswers.map(a => a.questionId);
  
  // Summarize what we recorded
  const stepSummary = workflow.steps.map((s, i) => {
    let desc = `${i + 1}. ${s.type}`;
    if (s.description) desc += `: ${s.description}`;
    if (s.inputValue) desc += ` (value: "${s.inputValue}")`;
    if (s.selectedOption) desc += ` (selected: "${s.selectedOption}")`;
    return desc;
  }).join('\n');

  // Build context from previous answers
  const answerContext = previousAnswers.length > 0
    ? `\nPREVIOUS ANSWERS:\n${previousAnswers.map(a => `- ${a.questionId}: "${a.answer}"`).join('\n')}`
    : '';

  return `You are helping a user teach you a new task. They described what they wanted to teach, then recorded their actions.

PRE-RECORDING INTENT:
- User said: "${teachingIntent.userDescription}"
- Expected action: ${teachingIntent.expectedAction.verb} ${teachingIntent.expectedAction.object}
- Is generic (works for any ${teachingIntent.expectedAction.object}): ${teachingIntent.expectedAction.isGeneric}
- Expected variables: ${teachingIntent.expectedVariables.join(', ') || 'none'}

RECORDED WORKFLOW (${workflow.stepCount} steps):
${stepSummary}
${answerContext}

YOUR TASK:
${previousAnswers.length === 0 
  ? 'Ask the FIRST clarifying question to understand variables and constants.'
  : previousAnswers.length < 2
    ? 'Based on their answers, ask ONE more clarifying question OR generate the final learned skill.'
    : 'Generate the FINAL learned skill summary - no more questions needed.'}

RESPOND IN JSON:

If asking a question:
{
  "action": "ask_question",
  "question": {
    "id": "<unique_id: variable_check, constant_check, or trigger_phrases>",
    "type": "variable" | "constant" | "trigger",
    "question": "<the question to ask>",
    "quickOptions": ["<option1>", "<option2>"],
    "allowFreeText": true
  },
  "aiResponse": "<friendly message introducing the question>"
}

If generating final skill (after 1-2 questions OR if intent was very clear):
{
  "action": "complete",
  "learnedSkill": {
    "whatItDoes": "<one sentence description>",
    "canonicalAction": {
      "verb": "${teachingIntent.expectedAction.verb}",
      "verbSynonyms": ["<synonym1>", "<synonym2>", "<synonym3>"],
      "object": "${teachingIntent.expectedAction.object}",
      "objectSynonyms": ["<synonym1>", "<synonym2>"]
    },
    "exampleQueries": [
      "<5-8 different ways user might ask for this task>"
    ],
    "extractableVariables": [
      {
        "name": "<variable name>",
        "patterns": ["the {X} <object>", "<verb> {X}"],
        "examples": ["<example1>", "<example2>"]
      }
    ],
    "constants": [
      {
        "name": "<constant name if any>",
        "value": "<the constant value>",
        "overridable": <true if user said "unless I say otherwise">,
        "overridePatterns": ["<pattern to override>"]
      }
    ],
    "domain": {
      "application": "<detected app: Salesforce, Gainsight, Google Sheets, etc.>",
      "category": "<reporting, data-entry, navigation, admin, etc.>"
    }
  },
  "aiResponse": "<friendly summary of what you learned>"
}

GUIDELINES:
- Keep questions SHORT and provide quick-select options
- Use context from pre-recording to ask SMART questions (not generic)
- If user said "a dashboard", confirm variable; if "this dashboard", skip variable question
- Detect app from URLs in steps (salesforce.com, gainsight.com, sheets.google.com, etc.)
- Generate diverse exampleQueries covering different phrasings
- Only 1-2 questions max, then complete`;
}

function parsePostRecordingResponse(
  geminiResponse: string,
  teachingIntent: TeachingIntent,
  workflow: { name: string; stepCount: number; steps: WorkflowStep[] },
  previousAnswers: Array<{ questionId: string; answer: string }>
): PostRecordingResponse {
  try {
    const jsonMatch = geminiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.action === 'ask_question' && parsed.question) {
      return {
        question: {
          id: parsed.question.id || `q_${Date.now()}`,
          type: parsed.question.type || 'variable',
          question: parsed.question.question,
          quickOptions: parsed.question.quickOptions,
          allowFreeText: parsed.question.allowFreeText ?? true,
        },
        isComplete: false,
        aiResponse: parsed.aiResponse || parsed.question.question,
      };
    }

    if (parsed.action === 'complete' && parsed.learnedSkill) {
      const skill: LearnedSkill = {
        originalIntent: teachingIntent,
        whatItDoes: parsed.learnedSkill.whatItDoes || `${capitalize(teachingIntent.expectedAction.verb)} ${teachingIntent.expectedAction.object}`,
        canonicalAction: {
          verb: parsed.learnedSkill.canonicalAction?.verb || teachingIntent.expectedAction.verb,
          verbSynonyms: parsed.learnedSkill.canonicalAction?.verbSynonyms || [],
          object: parsed.learnedSkill.canonicalAction?.object || teachingIntent.expectedAction.object,
          objectSynonyms: parsed.learnedSkill.canonicalAction?.objectSynonyms || [],
        },
        exampleQueries: parsed.learnedSkill.exampleQueries || [],
        extractableVariables: parsed.learnedSkill.extractableVariables || [],
        constants: parsed.learnedSkill.constants || [],
        domain: {
          application: parsed.learnedSkill.domain?.application || detectApplication(workflow.steps),
          category: parsed.learnedSkill.domain?.category || 'general',
        },
        teachingMetadata: {
          taughtAt: Date.now(),
          questionsAsked: previousAnswers.length,
          userConfirmed: false, // Will be set to true when user confirms
        },
      };

      return {
        isComplete: true,
        learnedSkill: skill,
        aiResponse: parsed.aiResponse || `Got it! I learned how to ${skill.whatItDoes.toLowerCase()}.`,
      };
    }

    // Fallback: complete with basic skill
    return createFallbackSkill(teachingIntent, workflow, previousAnswers);
  } catch (error) {
    console.error('Error parsing post-recording response:', error);
    return createFallbackSkill(teachingIntent, workflow, previousAnswers);
  }
}

function createFallbackSkill(
  teachingIntent: TeachingIntent,
  workflow: { name: string; stepCount: number; steps: WorkflowStep[] },
  previousAnswers: Array<{ questionId: string; answer: string }>
): PostRecordingResponse {
  const skill: LearnedSkill = {
    originalIntent: teachingIntent,
    whatItDoes: `${capitalize(teachingIntent.expectedAction.verb)} ${teachingIntent.expectedAction.object}`,
    canonicalAction: {
      verb: teachingIntent.expectedAction.verb,
      verbSynonyms: getVerbSynonyms(teachingIntent.expectedAction.verb),
      object: teachingIntent.expectedAction.object,
      objectSynonyms: [],
    },
    exampleQueries: [
      `${teachingIntent.expectedAction.verb} the ${teachingIntent.expectedAction.object}`,
      `${teachingIntent.expectedAction.verb} a ${teachingIntent.expectedAction.object}`,
    ],
    extractableVariables: teachingIntent.expectedVariables.map(v => ({
      name: v,
      patterns: [`the {X} ${teachingIntent.expectedAction.object}`],
      examples: [],
    })),
    constants: [],
    domain: {
      application: detectApplication(workflow.steps),
      category: 'general',
    },
    teachingMetadata: {
      taughtAt: Date.now(),
      questionsAsked: previousAnswers.length,
      userConfirmed: false,
    },
  };

  return {
    isComplete: true,
    learnedSkill: skill,
    aiResponse: `I learned how to ${skill.whatItDoes.toLowerCase()}. You can ask me to do this anytime!`,
  };
}

// ============================================================================
// Helpers
// ============================================================================

async function callGemini(prompt: string): Promise<string> {
  const geminiRequest = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2048,
    }
  };

  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(geminiRequest),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function detectApplication(steps: WorkflowStep[]): string {
  const urls = steps.map(s => s.url).filter(Boolean);
  
  for (const url of urls) {
    if (url.includes('salesforce.com')) return 'Salesforce';
    if (url.includes('gainsight.com')) return 'Gainsight';
    if (url.includes('sheets.google.com')) return 'Google Sheets';
    if (url.includes('docs.google.com')) return 'Google Docs';
    if (url.includes('hubspot.com')) return 'HubSpot';
    if (url.includes('zendesk.com')) return 'Zendesk';
    if (url.includes('servicenow.com')) return 'ServiceNow';
    if (url.includes('workday.com')) return 'Workday';
    if (url.includes('quickbooks.com')) return 'QuickBooks';
  }
  
  return 'Web Application';
}

function getVerbSynonyms(verb: string): string[] {
  const synonymMap: Record<string, string[]> = {
    download: ['export', 'get', 'fetch', 'pull', 'save', 'retrieve'],
    create: ['add', 'new', 'make', 'insert', 'generate'],
    update: ['edit', 'modify', 'change', 'revise'],
    delete: ['remove', 'clear', 'erase'],
    search: ['find', 'look for', 'locate', 'query'],
    navigate: ['go to', 'open', 'visit', 'access'],
    submit: ['send', 'save', 'confirm', 'complete'],
    select: ['choose', 'pick', 'set'],
    enter: ['type', 'input', 'fill in', 'write'],
  };

  return synonymMap[verb.toLowerCase()] || [];
}
