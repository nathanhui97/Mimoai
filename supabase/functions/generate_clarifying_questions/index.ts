/**
 * Generate Clarifying Questions Edge Function
 *
 * After AI analyzes a workflow, this generates 1-3 clarifying questions
 * to better understand the user's intent - like how a human would ask.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { SYSTEM_PROMPT_SHORT, getSystemPromptForTask } from '../_shared/system-prompt.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WorkflowContext {
  name: string;
  description?: string;
  stepCount: number;
  stepSummary: string; // Brief description of what steps do
  domain?: string; // Spreadsheet, CRM, etc.
  primaryGoal?: string;
  variableFields?: string[]; // User-named fields like ["Name", "Email", "Phone"]
  patterns?: string[]; // Detected patterns like "form-fill", "navigation"
}

interface ClarifyingQuestion {
  id: string;
  question: string;
  why: string; // Why AI is asking this (shown as hint)
  options: Array<{
    label: string; // A, B, C, D
    text: string;
    value: string; // Machine-readable value to store
  }>;
  allowCustom: boolean;
  category: 'intent' | 'context' | 'scope' | 'triggers';
}

interface GenerateQuestionsResponse {
  questions: ClarifyingQuestion[];
  hasQuestions: boolean;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { workflow }: { workflow: WorkflowContext } = await req.json();

    console.log(`[ClarifyingQuestions] Generating questions for: ${workflow.name}`);

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const prompt = buildQuestionsPrompt(workflow);

    const geminiRequest = {
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.4, // Slightly creative but focused
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
    };

    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiRequest),
    });

    if (!geminiResponse.ok) {
      const error = await geminiResponse.text();
      console.error('[ClarifyingQuestions] Gemini API error:', error);
      throw new Error(`Gemini API error: ${geminiResponse.status}`);
    }

    const geminiResult = await geminiResponse.json();
    const responseText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const result = parseQuestionsResponse(responseText);

    const duration = Date.now() - startTime;
    console.log(`[ClarifyingQuestions] Generated ${result.questions.length} questions in ${duration}ms`);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[ClarifyingQuestions] Error:', error);
    return new Response(
      JSON.stringify({
        questions: [],
        hasQuestions: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

function buildQuestionsPrompt(workflow: WorkflowContext): string {
  const systemContext = getSystemPromptForTask('generate_questions');

  return `${systemContext}

You are a new hire/trainee learning a task from your manager. The manager just showed you a workflow (a series of browser actions), and you want to ask 1-3 questions to understand the CONTEXT and PURPOSE - like a human would.

## What You Observed

**Task Name:** ${workflow.name}
**Steps:** ${workflow.stepCount} steps - ${workflow.stepSummary}
**Domain/App:** ${workflow.domain || 'Unknown'}
${workflow.variableFields?.length ? `**Input Fields:** ${workflow.variableFields.join(', ')}` : ''}
${workflow.description ? `**What it seems to do:** ${workflow.description}` : ''}

## How to Think Like a Trainee

Imagine your manager just showed you how to add data to a spreadsheet. You wouldn't ask:
- "Should I update existing entries or add new rows?" (too technical)
- "Which sheet should I use?" (too operational)

Instead, you'd ask:
- "What is this spreadsheet for? Is it tracking customers, leads, inventory?"
- "Who are the people I'm adding? New clients? Job applicants?"
- "When would you want me to do this? After a sales call? When someone signs up?"
- "Is there anything special about these entries I should know?"

## Your Goal

Ask questions that help you understand:
1. **THE PURPOSE** - What is this data/system for? Why does it exist?
2. **THE CONTEXT** - Who/what are we dealing with? What's the bigger picture?
3. **THE TRIGGER** - When/why would someone ask you to do this task?
4. **THE LANGUAGE** - How would they phrase the request naturally?

## Rules

1. **Ask about CONTEXT, not MECHANICS** - Don't ask technical "how" questions, ask "what/why/who" questions
2. **Be curious like a human** - What would genuinely help you understand this task better?
3. **Keep options simple and clear** - Use plain language, not jargon
4. **Maximum 2-3 questions** - Only ask what truly matters. 0-1 questions is often enough.
5. **Sound natural** - Like you're having a conversation, not filling out a form

## Question Categories

- **intent**: Understanding the purpose ("What is this spreadsheet tracking?")
- **context**: Understanding the bigger picture ("Who are these contacts? Customers? Leads?")
- **triggers**: How they'd ask you ("How would you normally ask me to do this?")
- **scope**: When to use this ("When would you want me to add someone here?")

## Response Format

Return ONLY valid JSON:

{
  "questions": [
    {
      "id": "q1",
      "question": "Natural question like a trainee would ask?",
      "why": "Why you're curious about this",
      "options": [
        { "label": "A", "text": "Option text", "value": "value_a" },
        { "label": "B", "text": "Option text", "value": "value_b" },
        { "label": "C", "text": "Option text", "value": "value_c" }
      ],
      "allowCustom": true,
      "category": "intent"
    }
  ],
  "hasQuestions": true
}

## Examples of GOOD Questions (Context-Focused)

For a spreadsheet with Name, Email, Phone:
- "What is this spreadsheet for? Is it a customer list, contact directory, or something else?" (intent)
- "Who are the people being added here - new leads, existing customers, team members?" (context)
- "How would you typically ask me to add someone? Like 'add John to the list' or something different?" (triggers)

For a CRM workflow:
- "What kind of opportunities are these - sales deals, partnerships, something else?" (context)
- "When would you want me to create one of these? After a meeting? When someone shows interest?" (scope)

For a form submission:
- "What's this form for? Applications? Registrations? Feedback?" (intent)
- "Who typically fills this out, and why?" (context)

## BAD Questions (Too Technical/Operational)

- "Should I update existing entries or create new ones?" (technical detail)
- "Which sheet should I use?" (operational detail)
- "How should I handle duplicates?" (edge case - not context)
- "What if the form fails to submit?" (error handling - not context)

Now generate 0-3 contextual questions that help you understand this task like a trainee would:`;
}

function parseQuestionsResponse(responseText: string): GenerateQuestionsResponse {
  try {
    let jsonStr = responseText.trim();

    // Handle markdown code blocks
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Validate and normalize questions
    const questions: ClarifyingQuestion[] = (parsed.questions || [])
      .slice(0, 3) // Max 3 questions
      .map((q: any, index: number) => ({
        id: q.id || `q${index + 1}`,
        question: q.question || 'Question',
        why: q.why || '',
        options: (q.options || []).slice(0, 4).map((opt: any, optIndex: number) => ({
          label: opt.label || String.fromCharCode(65 + optIndex), // A, B, C, D
          text: opt.text || 'Option',
          value: opt.value || `option_${optIndex}`,
        })),
        allowCustom: q.allowCustom !== false, // Default to true
        category: q.category || 'intent',
      }));

    return {
      questions,
      hasQuestions: questions.length > 0,
    };
  } catch (error) {
    console.error('[ClarifyingQuestions] Failed to parse response:', error);
    console.error('[ClarifyingQuestions] Raw response:', responseText.substring(0, 500));
    return { questions: [], hasQuestions: false };
  }
}
