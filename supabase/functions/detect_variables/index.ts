/**
 * Supabase Edge Function: detect_variables
 * Analyzes workflow step snapshots using Gemini Vision API to determine
 * which fields should be parameterized as variables for workflow execution.
 *
 * Focuses primarily on INPUT/TEXTAREA steps, with selective CLICK step analysis
 * for selectable options (dropdowns, radio buttons).
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SYSTEM_PROMPT_SHORT, getSystemPromptForTask } from '../_shared/system-prompt.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

interface StepMetadata {
  stepIndex: number;
  stepId: string;
  stepType: 'INPUT' | 'CLICK' | 'SELECT' | 'KEYBOARD';
  value?: string;
  label?: string;
  inputType?: string;
  elementRole?: string;
  elementTag?: string;
  placeholder?: string;
  isSelectableOption?: boolean; // True for dropdowns, radio buttons, etc.
  isDropdown?: boolean;         // Whether this is a dropdown/select
  dropdownOptions?: string[];   // Available options in dropdown (if known from DOM)
  columnHeader?: string;       // Column header for spreadsheet cells (e.g., "Price", "Quantity")
  cellReference?: string;      // Cell reference for spreadsheet cells (e.g., "B5", "A1")
}

interface StepForAnalysis {
  metadata: StepMetadata;
  beforeSnapshot?: string; // Base64 image
  afterSnapshot?: string;  // Base64 image
}

interface DetectVariablesRequest {
  steps: StepForAnalysis[];
  pageContext?: {
    url: string;
    title: string;
    pageType?: string;
  };
  initialFullPageSnapshot?: string; // Full page snapshot captured at recording start (for spreadsheet column headers)
}

interface VariableDefinition {
  stepIndex: number;
  stepId: string;
  fieldName: string;
  fieldLabel?: string;
  variableName: string;
  defaultValue: string;
  inputType?: string;
  isVariable: boolean;
  confidence: number;
  reasoning?: string;
  options?: string[];      // Available options for dropdown/select variables
  isDropdown?: boolean;    // Whether this is a dropdown/select variable
  columnHeader?: string;   // Column header for spreadsheet cells (e.g., "Name", "Email")
  cellReference?: string;  // Cell reference for spreadsheet cells (e.g., "A2", "B3")
}

interface DetectVariablesResponse {
  variables: VariableDefinition[];
  analysisCount: number;
  error?: string;
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
    const rawBody = await req.text();
    console.log('[detect_variables] Request received, body length:', rawBody.length);
    
    const payload: DetectVariablesRequest = JSON.parse(rawBody);

    if (!GEMINI_API_KEY) {
      console.error('[detect_variables] GEMINI_API_KEY is not set in environment variables');
      throw new Error('GEMINI_API_KEY not configured');
    }
    
    // Log API key status (first 10 chars only for security)
    console.log(`[detect_variables] GEMINI_API_KEY is set: ${GEMINI_API_KEY.substring(0, 10)}...`);

    if (!payload.steps || payload.steps.length === 0) {
      return new Response(JSON.stringify({ variables: [], analysisCount: 0 }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    
    // Log payload structure immediately after parsing
    console.log('[detect_variables] Payload parsed successfully:', {
      stepsCount: payload.steps?.length || 0,
      hasPageContext: !!payload.pageContext,
      hasInitialSnapshot: !!payload.initialFullPageSnapshot,
      initialSnapshotType: typeof payload.initialFullPageSnapshot,
      initialSnapshotLength: payload.initialFullPageSnapshot?.length || 0,
      initialSnapshotPreview: payload.initialFullPageSnapshot?.substring(0, 50) || 'N/A',
    });

    // Initialize Supabase client for caching
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Log initial full page snapshot status BEFORE cache check (so we can see if it's in the payload)
    console.log('[detect_variables] Initial full page snapshot check (BEFORE cache):', {
      hasInitialSnapshot: !!payload.initialFullPageSnapshot,
      snapshotLength: payload.initialFullPageSnapshot?.length || 0,
      snapshotType: typeof payload.initialFullPageSnapshot,
      snapshotPreview: payload.initialFullPageSnapshot?.substring(0, 50) || 'N/A',
      pageType: payload.pageContext?.pageType,
      pageUrl: payload.pageContext?.url?.substring(0, 80) || 'N/A',
    });

    // Check cache first
    // NOTE: Cache key intentionally excludes initialFullPageSnapshot to allow snapshot usage
    // even with cached results. We'll skip cache if snapshot is present to ensure it's used.
    const hasSnapshot = !!payload.initialFullPageSnapshot;
    const cacheKey = generateCacheKey(payload); // Generate cache key for potential saving later
    let cached: DetectVariablesResponse | null = null;
    
    if (!hasSnapshot) {
      // Only check cache if no snapshot (snapshot requires fresh analysis)
      cached = await checkCache(supabase, cacheKey);
      
      if (cached) {
        console.log('[detect_variables] Cache hit for detect_variables:', cacheKey);
        return new Response(JSON.stringify(cached), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    } else {
      console.log('[detect_variables] Skipping cache check - snapshot present, requires fresh analysis');
    }
    
    console.log('[detect_variables] No cache hit, proceeding with AI analysis');

    // Analyze each step with snapshots
    const variables: VariableDefinition[] = [];
    let analysisCount = 0;

    for (const step of payload.steps) {
      // For INPUT steps, we can analyze even without snapshots (value is what matters)
      // For CLICK steps (dropdowns), we need at least a snapshot, value, or dropdown options
      const isInputStep = step.metadata.stepType === 'INPUT' || step.metadata.stepType === 'KEYBOARD';
      const isClickStep = step.metadata.stepType === 'CLICK';
      const isDropdown = step.metadata.isDropdown;
      const hasSnapshot = !!step.afterSnapshot || !!step.beforeSnapshot;
      const hasValue = !!step.metadata.value;
      const hasDropdownOptions = isDropdown && step.metadata.dropdownOptions && step.metadata.dropdownOptions.length > 0;
      
      console.log(`[detect_variables] Processing step ${step.metadata.stepIndex}:`, {
        stepType: step.metadata.stepType,
        isDropdown,
        hasSnapshot,
        hasValue,
        hasDropdownOptions,
        value: step.metadata.value,
        label: step.metadata.label,
        dropdownOptions: step.metadata.dropdownOptions,
      });
      
      // For INPUT steps, require at least a value
      if (isInputStep && !hasValue) {
        console.log(`[detect_variables] Skipping INPUT step ${step.metadata.stepIndex}: no value`);
        continue;
      }
      
      // For CLICK steps (dropdowns), require at least: snapshot, value, or dropdown options
      if (isClickStep) {
        // Check if this looks like a dropdown option (even if not explicitly marked)
        const selector = step.metadata.selector || '';
        const looksLikeDropdown = isDropdown || 
                                  step.metadata.elementRole === 'option' ||
                                  selector.includes('role="option"') || 
                                  selector.includes("role='option'") ||
                                  selector.includes('[role="option"]') ||
                                  selector.includes("[role='option']") ||
                                  selector.includes('listbox');
        
        console.log(`[detect_variables] CLICK step ${step.metadata.stepIndex} dropdown check:`, {
          isDropdown,
          elementRole: step.metadata.elementRole,
          selector: selector.substring(0, 100),
          looksLikeDropdown,
          hasSnapshot,
          hasValue,
          hasDropdownOptions,
          label: step.metadata.label,
        });
        
        if (looksLikeDropdown) {
          // It's a dropdown - analyze if we have ANY data (snapshot, value, options, or even just a label)
          if (hasSnapshot || hasValue || hasDropdownOptions || step.metadata.label) {
            console.log(`[detect_variables] ✅ Including dropdown CLICK step ${step.metadata.stepIndex}`);
          } else {
            console.log(`[detect_variables] ⚠️ Dropdown CLICK step ${step.metadata.stepIndex} has no data, but including anyway for AI analysis`);
          }
        } else {
          // Not a dropdown, skip (navigation clicks are filtered out client-side)
          console.log(`[detect_variables] ❌ Skipping non-dropdown CLICK step ${step.metadata.stepIndex}`);
          continue;
        }
      }
      
      // Skip if no snapshot AND no value AND not a dropdown with options
      if (!isInputStep && !isDropdown && !hasSnapshot && !hasValue) {
        console.log(`[detect_variables] Skipping step ${step.metadata.stepIndex}: no snapshot and no value`);
        continue;
      }

      analysisCount++;

      // Log if this step should get the full page snapshot
      const isSpreadsheetStep = step.metadata.cellReference || step.metadata.columnHeader;
      const isDataTablePage = payload.pageContext?.pageType === 'data_table';
      const shouldGetSnapshot = payload.initialFullPageSnapshot && (isDataTablePage || isSpreadsheetStep);
      
      if (payload.initialFullPageSnapshot) {
        console.log(`[detect_variables] Step ${step.metadata.stepIndex} snapshot eligibility:`, {
          hasInitialSnapshot: !!payload.initialFullPageSnapshot,
          snapshotLength: payload.initialFullPageSnapshot.length,
          pageType: payload.pageContext?.pageType,
          isDataTablePage,
          cellReference: step.metadata.cellReference,
          columnHeader: step.metadata.columnHeader,
          isSpreadsheetStep,
          shouldGetSnapshot,
        });
      }

      // Analyze this step (pass initial full page snapshot for spreadsheet column header detection)
      const result = await analyzeStep(step, payload.pageContext, payload.initialFullPageSnapshot);
      
      console.log(`[detect_variables] Step ${step.metadata.stepIndex} analysis result:`, {
        hasResult: !!result,
        isVariable: result?.isVariable,
        confidence: result?.confidence,
        fieldName: result?.fieldName,
        reasoning: result?.reasoning,
      });
      
      if (result && result.isVariable) {
        console.log(`[detect_variables] ✅ Adding variable for step ${step.metadata.stepIndex}: ${result.fieldName}`);
        variables.push(result);
      } else {
        console.log(`[detect_variables] ❌ Not adding step ${step.metadata.stepIndex} as variable:`, {
          hasResult: !!result,
          isVariable: result?.isVariable,
          confidence: result?.confidence,
        });
      }
    }

    const response: DetectVariablesResponse = {
      variables,
      analysisCount,
    };

    // Cache the result (30 minute TTL - variables don't change often)
    // Only cache if no snapshot was used (to avoid caching results without snapshot analysis)
    if (!hasSnapshot) {
      await saveToCache(supabase, cacheKey, response, 30 * 60);
    } else {
      console.log('[detect_variables] Skipping cache save - snapshot was used in analysis');
    }

    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error in detect_variables:', error);
    return new Response(
      JSON.stringify({
        variables: [],
        analysisCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
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

/**
 * Analyze a single step to determine if it contains a variable
 * @param initialFullPageSnapshot - Optional full page snapshot captured at recording start (for spreadsheet column headers)
 */
async function analyzeStep(
  step: StepForAnalysis,
  pageContext?: { url: string; title: string; pageType?: string },
  initialFullPageSnapshot?: string
): Promise<VariableDefinition | null> {
  const { metadata, beforeSnapshot, afterSnapshot } = step;

  // Build the prompt based on step type (pass snapshots for context-aware prompts)
  const prompt = buildVariableDetectionPrompt(metadata, pageContext, beforeSnapshot, afterSnapshot, initialFullPageSnapshot);

  // Build Gemini API request with screenshots
  const parts: any[] = [{ text: prompt }];

  // Check if we should include the initial full page snapshot for spreadsheet column header detection
  // This is critical for identifying column headers when cells are scrolled down
  // Include snapshot if we have it AND:
  // 1. Step has spreadsheet context (cellReference or columnHeader) OR
  // 2. Page is identified as a data table OR
  // 3. URL indicates it's a spreadsheet domain
  const isSpreadsheetStep = !!(metadata.cellReference || metadata.columnHeader);
  const isDataTablePage = pageContext?.pageType === 'data_table';
  const isSpreadsheetUrl = pageContext?.url ? (
    pageContext.url.includes('docs.google.com/spreadsheets') ||
    pageContext.url.includes('excel.office.com') ||
    pageContext.url.includes('onedrive.live.com') ||
    pageContext.url.includes('office365.com')
  ) : false;
  
  // For spreadsheet steps, skip snapshot-based header detection
  // Just use cell reference as variable name (users can rename in UI)
  const needsSnapshot = false; // Disabled - use cell references instead
  const hasSnapshot = !!initialFullPageSnapshot;
  const shouldIncludeSnapshot = !!(hasSnapshot && needsSnapshot);
  
  // Snapshot-based header detection disabled for reliability
  // Using cell references as default variable names instead
  console.log(`[detect_variables] Using cell reference as variable name for step ${metadata.stepIndex}:`, {
    cellReference: metadata.cellReference,
    columnHeader: metadata.columnHeader,
    message: 'Snapshot-based header detection disabled. Users can rename variables in UI.',
  });
  
  console.log(`[detect_variables] analyzeStep for step ${metadata.stepIndex} - Full page snapshot check:`, {
    hasInitialSnapshot: hasSnapshot,
    snapshotLength: initialFullPageSnapshot?.length || 0,
    pageType: pageContext?.pageType,
    pageUrl: pageContext?.url?.substring(0, 80) || 'N/A', // First 80 chars
    isDataTablePage,
    isSpreadsheetUrl,
    isSpreadsheetStep,
    needsSnapshot,
    shouldIncludeSnapshot,
    cellReference: metadata.cellReference,
    columnHeader: metadata.columnHeader,
    label: metadata.label,
    value: metadata.value,
  });
  
  // Add initial full page snapshot FIRST (before cell snapshots) so AI sees headers first
  // This is critical for identifying column headers when cells are scrolled down
  if (shouldIncludeSnapshot && initialFullPageSnapshot) {
    console.log(`[detect_variables] ✅ INCLUDING full page snapshot FIRST for step ${metadata.stepIndex} (spreadsheet cell: ${metadata.cellReference || 'N/A'}, column: ${metadata.columnHeader || 'N/A'})`);
    const fullPageBase64 = extractBase64Data(initialFullPageSnapshot);
    const columnLetter = metadata.cellReference ? metadata.cellReference.charAt(0) : 'N/A';
    const cellRef = metadata.cellReference || 'N/A';
    
    // Log base64 data length to verify image is being extracted correctly
    console.log(`[detect_variables] Full page snapshot base64 length: ${fullPageBase64.length}, original snapshot length: ${initialFullPageSnapshot.length}`);
    
    parts.push({
      text: `TASK: Find the column header for cell ${cellRef} in this spreadsheet.

Cell: ${cellRef} (column ${columnLetter})
Value entered: "${metadata.value || ''}"

The spreadsheet image below is zoomed out (33%) to show multiple columns. Look at row 1 to find the column headers.`
    });
    parts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: fullPageBase64
      }
    });
    parts.push({
      text: `Instructions:
1. Look at row 1 in the image - this is usually the header row
2. Read ALL column headers from left to right (A, B, C, D, etc.)
3. Find the header text for column ${columnLetter}
4. Use that EXACT header text as fieldName (read the complete text, not just the first word)

Respond with JSON only:
{
  "isVariable": true,
  "confidence": 0.9,
  "fieldName": "the exact header text from column ${columnLetter}",
  "variableName": "camelCaseVersion",
  "headersFound": "A: [header], B: [header], C: [header]...",
  "reasoning": "Found header at row X, column ${columnLetter} says [text]"
}

CRITICAL: fieldName must be the actual header text, NOT "${cellRef}" or "${columnLetter}" or "Cell ${cellRef}".`
    });
    console.log(`[detect_variables] Full page snapshot image added FIRST to Gemini request for step ${metadata.stepIndex}`);
  } else if (initialFullPageSnapshot) {
    console.log(`[detect_variables] ⚠️ Full page snapshot available but NOT included for step ${metadata.stepIndex}:`, {
      reason: !isSpreadsheetStep ? 'Not a spreadsheet step (no cellReference/columnHeader)' : 
              !isDataTablePage ? 'Page not identified as data_table' : 'Unknown reason',
      cellReference: metadata.cellReference,
      columnHeader: metadata.columnHeader,
      pageType: pageContext?.pageType,
    });
  }

  // Add before snapshot if available (helps see what changed)
  if (beforeSnapshot) {
    const beforeBase64 = extractBase64Data(beforeSnapshot);
    parts.push({
      text: '\n\nBEFORE Screenshot (state before user action):'
    });
    parts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: beforeBase64
      }
    });
  }

  // Add after snapshot if available
  // For INPUT steps without snapshots, we can still analyze using the value and metadata
  if (afterSnapshot) {
    const afterBase64 = extractBase64Data(afterSnapshot);
    parts.push({
      text: beforeSnapshot ? '\n\nAFTER Screenshot (state after user action):' : '\n\nScreenshot of the element/action:'
    });
    parts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: afterBase64
      }
    });
  }

  if (!afterSnapshot) {
    if (metadata.stepType === 'INPUT' || metadata.stepType === 'KEYBOARD') {
      // For INPUT steps without snapshots, add a note in the prompt
      let inputNote = '\n\nNOTE: No screenshot available for this input field, but the value entered is: "' + (metadata.value || '') + '".';
      
      // ENHANCED: For spreadsheet steps, provide additional context
      if (metadata.cellReference) {
        inputNote += `\n\nThis is a SPREADSHEET INPUT in cell ${metadata.cellReference}.`;
        
        if (metadata.columnHeader) {
          // We have the column header - use it!
          inputNote += `\nColumn header: "${metadata.columnHeader}"`;
          inputNote += `\n\nIMPORTANT: Use the column header "${metadata.columnHeader}" as the fieldName. Do NOT use the cell reference "${metadata.cellReference}" as fieldName.`;
        } else {
          // No column header - give AI guidance
          const columnLetter = metadata.cellReference.charAt(0);
          inputNote += `\nColumn letter: ${columnLetter}`;
          inputNote += `\n\nColumn header was not captured. Infer the field name based on:`;
          inputNote += `\n1. The value being entered: "${metadata.value}"`;
          inputNote += `\n2. Common spreadsheet patterns (A=Name, B=Email, C=Phone, etc.)`;
          inputNote += `\n3. Context from the label: "${metadata.label || 'N/A'}"`;
          inputNote += `\n\nIMPORTANT: Provide a meaningful fieldName (e.g., "Name", "Email", "Phone"), NOT "${metadata.cellReference}" or "${columnLetter}".`;
        }
      } else {
        inputNote += ' Analyze based on the value, field label, and input type.';
      }
      
      parts[0] = { 
        text: prompt + inputNote
      };
    } else if (metadata.stepType === 'CLICK' && metadata.isDropdown) {
      // For DROPDOWN CLICK steps without snapshots, add a note with available options
      const optionsNote = metadata.dropdownOptions && metadata.dropdownOptions.length > 0
        ? `\n\nNOTE: No screenshot available, but you have the dropdown options from the DOM: ${metadata.dropdownOptions.join(', ')}. The selected option is: "${metadata.value || 'unknown'}". Analyze based on the dropdown label, available options, and selected value.`
        : `\n\nNOTE: No screenshot available. Analyze based on the dropdown label "${metadata.label || 'dropdown'}" and selected value "${metadata.value || 'unknown'}".`;
      parts[0] = { 
        text: prompt + optionsNote
      };
    }
  }

  const geminiRequest = {
    contents: [{
      parts
    }],
    generationConfig: {
      temperature: 0.2, // Low temperature for consistent classification
      maxOutputTokens: 1024,
    }
  };

  try {
    const geminiResponse = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': GEMINI_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geminiRequest),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error(`[detect_variables] Gemini API error for step ${metadata.stepIndex}:`, errorText);
      // Don't return null immediately - check fallback first
      const fallbackResult = checkFallbackHeuristic(metadata);
      if (fallbackResult) {
        console.log(`[detect_variables] ✅ Using fallback due to API error for step ${metadata.stepIndex}`);
        return fallbackResult;
      }
      return null;
    }

    const geminiData = await geminiResponse.json();
    const result = parseVariableResponse(geminiData, metadata, shouldIncludeSnapshot, initialFullPageSnapshot);
    
    console.log(`[detect_variables] After parsing, result for step ${metadata.stepIndex}:`, {
      hasResult: !!result,
      isVariable: result?.isVariable,
      confidence: result?.confidence,
      value: metadata.value,
      label: metadata.label,
      stepType: metadata.stepType,
    });
    
    // Use fallback ONLY if AI completely failed (returned null or error)
    // If AI returned a result (even if isVariable: false), trust the AI
    if (!result) {
      // AI failed completely - use fallback as backup
      const fallbackResult = checkFallbackHeuristic(metadata);
      if (fallbackResult) {
        console.log(`[detect_variables] ✅ Using fallback (AI failed) for step ${metadata.stepIndex}: ${fallbackResult.fieldName}`);
        return fallbackResult;
      }
      return null;
    }
    
    // VALIDATION: Reject generic field names for spreadsheet steps
    // If AI returned a generic name like "Cell X Value" or "Column X Value", it didn't read the header
    // Also reject pure cell references like "A74", "B75" - these are NOT valid field names
    // Apply this validation for ALL spreadsheet steps, even if snapshot wasn't available
    const isSpreadsheetStep = !!(metadata.cellReference || metadata.columnHeader);
    if (result.isVariable && result.fieldName && isSpreadsheetStep && metadata.cellReference) {
      const columnLetter = metadata.cellReference.charAt(0);
      const genericPatterns = [
        /^Cell\s+[A-Z]+\d+\s*Value$/i,
        /^[A-Z]+\d+\s+Cell\s+Value$/i,
        /^Column\s+[A-Z]+\s+Value$/i,
        /^[A-Z]+\s+Column\s+Value$/i,
        /^Cell\s+[A-Z]+\d+$/i,
        /^Column\s+[A-Z]+$/i,
        /^[A-Z]+\d+\s+Value$/i,
        /^[A-Z]+\d+$/i,  // Reject pure cell references like "A66", "B66", "C66"
      ];
      
      // Also reject single-letter field names that match the column letter (e.g., "A", "B", "C")
      // This means the AI read the column letter label instead of the actual header text
      const isSingleLetterMatch = result.fieldName.trim().length === 1 && 
                                  result.fieldName.trim().toUpperCase() === columnLetter.toUpperCase();
      
      // Check if fieldName is a cell reference (e.g., "A66", "B65", "C66")
      const isCellReference = /^[A-Z]+\d+$/i.test(result.fieldName.trim());
      
      const isGeneric = genericPatterns.some(pattern => pattern.test(result.fieldName)) || isSingleLetterMatch || isCellReference;
      if (isGeneric) {
        let reason = '';
        if (isCellReference) {
          reason = shouldIncludeSnapshot 
            ? `AI returned cell reference "${result.fieldName}" instead of reading actual header text from the snapshot`
            : `AI returned cell reference "${result.fieldName}" but snapshot was not available to read headers.`;
        } else if (isSingleLetterMatch) {
          reason = shouldIncludeSnapshot
            ? `AI returned column letter "${result.fieldName}" instead of reading actual header text`
            : `AI returned column letter "${result.fieldName}" but snapshot was not available to read headers.`;
        } else {
          reason = shouldIncludeSnapshot
            ? `AI did not read column header from snapshot`
            : `AI did not provide proper header name and snapshot was not available`;
        }
        console.log(`[detect_variables] ⚠️ Generic fieldName "${result.fieldName}" for step ${metadata.stepIndex} - ${reason}`);
        console.log(`[detect_variables] Cell reference: ${metadata.cellReference}, hasSnapshot: ${shouldIncludeSnapshot}`);
        
        // Use cell reference as fallback (user will rename in UI)
        const fallbackFieldName = metadata.cellReference || `Column ${columnLetter}`;
        const fallbackVarName = metadata.cellReference 
          ? `cell${metadata.cellReference.replace(/[^A-Z0-9]/gi, '')}` 
          : `column${columnLetter}`;
        const fallbackReasoning = `${reason} Using cell reference as default name. User can rename this variable in the UI.`;
        console.log(`[detect_variables] 🔄 Using cell reference fallback: "${fallbackFieldName}"`);
        
        result.fieldName = fallbackFieldName;
        result.variableName = fallbackVarName;
        result.reasoning = fallbackReasoning;
        // DON'T return null - continue with modified result
      }
    }
    
    // AI returned a result - trust it
    if (result.isVariable) {
      console.log(`[detect_variables] ✅ AI detected variable for step ${metadata.stepIndex}: ${result.fieldName} (confidence: ${result.confidence})`);
    } else {
      console.log(`[detect_variables] AI determined step ${metadata.stepIndex} is NOT a variable: ${result.reasoning || 'no reasoning provided'}`);
    }
    
    return result;
  } catch (error) {
    console.error(`[detect_variables] Exception analyzing step ${metadata.stepIndex}:`, error);
    // Only use fallback if there's an exception (AI completely failed)
    const fallbackResult = checkFallbackHeuristic(metadata);
    if (fallbackResult) {
      console.log(`[detect_variables] ✅ Using fallback due to exception for step ${metadata.stepIndex}: ${fallbackResult.fieldName}`);
      return fallbackResult;
    }
    return null;
  }
}

/**
 * Build prompt for variable detection based on step type
 * @param initialFullPageSnapshot - Optional full page snapshot for spreadsheet column header detection
 */
function buildVariableDetectionPrompt(
  metadata: StepMetadata,
  pageContext?: { url: string; title: string; pageType?: string },
  beforeSnapshot?: string,
  afterSnapshot?: string,
  initialFullPageSnapshot?: string
): string {
  const systemContext = getSystemPromptForTask('extract_variables');

  let prompt = `${systemContext}

PRODUCT CONTEXT:
You are analyzing steps from a browser automation tool called "mimoai".
This tool allows users to record repetitive browser tasks (like filling forms, creating promotions, processing orders)
and then execute them multiple times with different input values. 

The goal is to identify which values the user typed should be "variables" - meaning they can be changed 
each time the workflow runs. For example, if a user records filling a form with "Budget Amount: 1000", 
they should be able to run the workflow again with "Budget Amount: 2000" or any other amount.

VARIABLES = Values that users would want to change each execution (amounts, names, dates, selections)
STATIC = Values that should stay the same every time (system IDs, fixed configurations, navigation)

TASK: Analyze this workflow step to determine if the user-entered value should be a VARIABLE (parameterized, different each execution) or STATIC (same value each time).

`;

  if (pageContext) {
    prompt += `Page Context:
- URL: ${pageContext.url}
- Title: ${pageContext.title}
${pageContext.pageType ? `- Page Type: ${pageContext.pageType}` : ''}

`;
  }

  prompt += `Step Information:
- Step Type: ${metadata.stepType}
- Value Entered: "${metadata.value || ''}"
${metadata.label ? `- Field Label: "${metadata.label}"` : ''}
${metadata.inputType ? `- Input Type: ${metadata.inputType}` : ''}
${metadata.placeholder ? `- Placeholder: "${metadata.placeholder}"` : ''}
${metadata.elementRole ? `- Element Role: ${metadata.elementRole}` : ''}
${metadata.elementTag ? `- Element Tag: ${metadata.elementTag}` : ''}

`;

  // CRITICAL: Include column header for spreadsheet cells
  // This is the most reliable way to identify what the column represents
  if (metadata.columnHeader || metadata.cellReference) {
    prompt += `SPREADSHEET CONTEXT (HIGH PRIORITY):
${metadata.columnHeader ? `- Column Header: "${metadata.columnHeader}"` : ''}
${metadata.cellReference ? `- Cell Reference: ${metadata.cellReference}` : ''}
${metadata.columnHeader ? `- Cell Value: "${metadata.value || ''}"` : ''}

**IMPORTANT: If columnHeader is provided, USE IT as the field name for variable naming.**
The column header (e.g., "${metadata.columnHeader}") accurately describes what this cell represents.
For example, if columnHeader is "Price" and value is "100", the variable should be named "price" or "priceAmount".

`;
  }

  // CRITICAL: Include initial full page snapshot for spreadsheet column header detection
  // This allows AI to see all column headers even when cells are scrolled down
  // Check if this is a spreadsheet domain by URL or if step has spreadsheet context
  const isSpreadsheetUrl = pageContext?.url ? (
    pageContext.url.includes('docs.google.com/spreadsheets') ||
    pageContext.url.includes('excel.office.com') ||
    pageContext.url.includes('onedrive.live.com') ||
    pageContext.url.includes('office365.com')
  ) : false;
  const hasSpreadsheetContext = !!(metadata.cellReference || metadata.columnHeader);
  const isDataTablePage = pageContext?.pageType === 'data_table';
  const shouldIncludeFullPageSnapshot = !!(initialFullPageSnapshot && (isSpreadsheetUrl || isDataTablePage || hasSpreadsheetContext));
  
  // Define cellRef and columnLetter for use in prompt
  const cellRef = metadata.cellReference || 'N/A';
  const columnLetter = metadata.cellReference ? metadata.cellReference.charAt(0) : 'N/A';
  
  if (shouldIncludeFullPageSnapshot && initialFullPageSnapshot) {
    prompt += `\n\n═══════════════════════════════════════════════════════════════
🎯 CRITICAL: SPREADSHEET COLUMN HEADER DETECTION (HIGHEST PRIORITY)
═══════════════════════════════════════════════════════════════

A FULL PAGE SNAPSHOT of the spreadsheet (captured at recording start after page refresh) is provided below.
**The page was refreshed at recording start, so headers are visible in the snapshot.**
**YOU MUST USE THIS SNAPSHOT TO INTELLIGENTLY SEARCH FOR AND IDENTIFY THE COLUMN HEADER** for the cell being analyzed.

CURRENT CELL BEING ANALYZED:
- Cell Reference: ${cellRef}
- Cell Value: "${metadata.value || ''}"
${metadata.columnHeader ? `- Detected Column Header: "${metadata.columnHeader}" (but verify with snapshot)` : ''}

**STEP-BY-STEP INSTRUCTIONS (MANDATORY):**

1. **LOOK AT THE FULL PAGE SNAPSHOT FIRST** - This shows the entire spreadsheet including column headers

2. **INTELLIGENTLY FIND THE HEADER ROW** - Headers can be in ANY row. Look for:
   - The row with descriptive text labels (not data values)
   - Different visual styling (bold, background color, borders)
   - Typically the topmost row with labels, but could be row 1, 2, 3, or any row
   - May be frozen/sticky at the top

3. **IDENTIFY ALL COLUMN HEADERS** - Once you find the header row:
   - Read each column's COMPLETE header text from left to right
   - Read ALL words in each header (e.g., "Marketplace Fee" not just "Marketplace")
   - Note which row contains the headers (e.g., "Row 1", "Row 2", etc.)
   - Headers can be multi-word - capture the FULL text

4. **MATCH THE CELL TO ITS COLUMN** - Cell ${cellRef} is in column ${columnLetter}:
   - Find the COMPLETE header text for column ${columnLetter} from the header row you identified
   - Read the ENTIRE header text, including all words (e.g., if it says "Marketplace Fee", use both words)
   - The header text tells you what this column represents

5. **USE THE COMPLETE HEADER TEXT AS FIELD NAME** - Use the EXACT, FULL text you see:
   - "Marketplace Fee" (not "Marketplace")
   - "Store UUID" (not "Store")
   - "ORG ID" (not "ORG")
   - "Price per Unit" (not "Price")

**EXAMPLES:**
- Example 1: Cell reference: "B15", value: "1000"
  - Examine the image and find the header row (could be row 1, 2, or any row)
  - If header row is row 1 and column B header says "Price":
    - headerRowPosition: "Row 1"
    - headersFound: "Column A: Name, Column B: Price, Column C: Quantity"
    - fieldName: "Price"
    - variableName: "price"
    - confidence: 0.9+

- Example 2: Cell reference: "D43", value: "40%"
  - Examine the image and find the header row
  - If header row is row 1 and column D header says "Marketplace Fee" (TWO WORDS):
    - headerRowPosition: "Row 1"
    - headersFound: "Column A: Store, Column B: Store UUID, Column C: ORG ID, Column D: Marketplace Fee, Column E: Status"
    - fieldName: "Marketplace Fee"  // <-- COMPLETE text, not just "Marketplace"
    - variableName: "marketplaceFee"
    - confidence: 0.9+

**HANDLING PARTIAL VISIBILITY:**
- If not all columns are visible in the snapshot, read the headers that ARE visible
- The header row should be at the top of the image (page was refreshed, so it starts at top)
- The snapshot may not show all columns if the spreadsheet is wide - that's okay, just read the headers that are visible

**CRITICAL RULES:**
- ✅ ALWAYS examine the full page snapshot FIRST
- ✅ INTELLIGENTLY SEARCH for the header row - don't assume it's row 1
- ✅ Headers can be in ANY row - find them by visual inspection
- ✅ Use the ACTUAL header text you see in the image
- ✅ The header text is the most accurate field name
- ❌ DO NOT hardcode "row 1" or "A1/B1" - SEARCH for headers intelligently
- ❌ DO NOT use generic names like "Cell ${cellRef}" or "Column ${columnLetter}"
- ❌ DO NOT use cell references like "${cellRef}" as field names

═══════════════════════════════════════════════════════════════\n\n`;
  }

  if (metadata.stepType === 'INPUT' || metadata.stepType === 'KEYBOARD') {
    prompt += `ANALYZE THIS INPUT FIELD USING VISUAL CONTEXT:

${beforeSnapshot && afterSnapshot 
  ? 'You have BEFORE and AFTER screenshots. Compare them to see what changed visually.' 
  : afterSnapshot 
    ? 'You have a screenshot showing the field AFTER the user typed. Analyze the visual context.' 
    : beforeSnapshot
      ? 'You have a screenshot showing the field BEFORE the user typed. Use this for context.' 
      : 'No screenshot available - analyze based on metadata only.'}

CRITICAL: Use the SCREENSHOT to understand:
1. **What field is this?** Look for:
   - Field labels visible in the screenshot (text above, beside, or inside the field)
   - Placeholder text visible in the field
   - Surrounding context (form section, nearby fields, page layout)
   - Field position and visual styling

2. **What did the user type?** Look for:
   - The text/value visible in the input field in the screenshot
   - Compare before/after to see what changed
   - The visual appearance of the entered value

3. **Field context from screenshot:**
   - What form is this part of? (registration, payment, search, etc.)
   - What other fields are nearby? (helps understand the field's purpose)
   - Visual indicators (required field markers, icons, etc.)

METADATA (use as backup if not visible in screenshot):
VALUE ENTERED: "${metadata.value || ''}"
${metadata.label ? `FIELD LABEL: "${metadata.label}"` : ''}
${metadata.inputType ? `INPUT TYPE: ${metadata.inputType}` : ''}
${metadata.placeholder ? `PLACEHOLDER: "${metadata.placeholder}"` : ''}

A value is DEFINITELY a VARIABLE if:
- The field label contains ANY of these words: "Amount", "Budget", "Price", "Cost", "Quantity", "Number", "Percentage", "Rate", "Fee", "Total", "Value", "Count"
- The field label contains ANY of these words: "Name", "Email", "Phone", "Address", "City", "State", "Zip", "Country", "Company", "Title"
- The field label contains ANY of these words: "Date", "Time", "Start", "End", "Duration", "Period"
- The value is a NUMBER (like "1000", "100", "50", etc.) in ANY input field - numbers are almost always variables
- The screenshot shows the user typed a value that looks like personal/user data
- The screenshot context suggests this is a form field for user-entered data
- The field appears in a form where users would enter different values each time

EXAMPLES OF VARIABLES (mark as isVariable: true, confidence: 0.8+):
- "1000" in a field labeled "Budget Amount" → VARIABLE (confidence: 0.9)
- "100" in a field labeled "Restaurant Funding Percentage" → VARIABLE (confidence: 0.9)
- "50" in a field labeled "Quantity" → VARIABLE (confidence: 0.9)
- Any number in any amount/budget/price field → VARIABLE (confidence: 0.8+)
- Email addresses, names, addresses → VARIABLE (confidence: 0.9+)
- Dates, times → VARIABLE (confidence: 0.8+)

A value is STATIC (NOT a variable) ONLY if:
- The screenshot clearly shows it's a system-generated ID (like "ID: 12345" or "UUID: abc-123")
- The screenshot shows it's a fixed system configuration that never changes
- The field is clearly a read-only system field (not an input field)
- The value is clearly a system constant (like "Version: 2.0" or "Status: Active")

CRITICAL RULES:
1. **NUMBERS ARE ALMOST ALWAYS VARIABLES** - If you see a number in an input field, it's almost certainly a variable (confidence: 0.8+)
2. **When in doubt, mark it as a VARIABLE** - It's better to detect too many variables than too few
3. **Field labels with "Amount", "Budget", "Price", "Percentage" = VARIABLE** (confidence: 0.9+)
4. **User-typed values in form fields = VARIABLE** (confidence: 0.8+)

`;
  } else if (metadata.stepType === 'CLICK' && metadata.isSelectableOption) {
    if (metadata.isDropdown) {
      prompt += `ANALYZE THIS DROPDOWN SELECTION:

This is a click on a dropdown/select menu option where the user selected a choice from multiple available options.

${metadata.dropdownOptions && metadata.dropdownOptions.length > 0 
  ? `AVAILABLE OPTIONS IN THIS DROPDOWN: ${metadata.dropdownOptions.join(', ')}\n` 
  : ''}
${metadata.value ? `SELECTED OPTION: "${metadata.value}"\n` : ''}
${metadata.label ? `DROPDOWN LABEL/FIELD NAME: "${metadata.label}"\n` : ''}

${beforeSnapshot && afterSnapshot 
  ? 'You have BEFORE and AFTER screenshots. Compare them to see what option was selected and what changed visually.' 
  : afterSnapshot 
    ? 'You have a screenshot showing the dropdown AFTER selection. Analyze the visual context.' 
    : metadata.dropdownOptions && metadata.dropdownOptions.length > 0
      ? 'No screenshot available, but you have the list of available options from the DOM. Use this to understand the dropdown.'
      : 'No screenshot available. Analyze based on metadata only.'}

CRITICAL RULES FOR DROPDOWNS:
1. **DROPDOWNS ARE ALMOST ALWAYS VARIABLES** - Users select different options each time they run the workflow
2. **If the dropdown has 3+ options, it's DEFINITELY a VARIABLE** (confidence: 0.95+)
3. **If the dropdown label contains words like "Select", "Choose", "Type", "Category", "Plan", "Reason" = VARIABLE** (confidence: 0.9+)
4. **Only mark as STATIC if it's clearly a navigation button or system toggle**

EXAMPLES OF DROPDOWN VARIABLES (mark as isVariable: true, confidence: 0.9+):
- "BOGO" selected from "Select Promotion Type" dropdown with options [BOGO, FLAT, FREE DELIVERY, ...] → VARIABLE (confidence: 0.95)
- "UberEats Growth" selected from "Reason for Uber spend" dropdown → VARIABLE (confidence: 0.9)
- Any dropdown where user chooses from multiple options → VARIABLE (confidence: 0.9+)

A selection is STATIC (NOT a variable) ONLY if:
- The screenshot clearly shows it's a navigation button (Next, Submit, Continue)
- The screenshot shows it's a fixed system setting that never changes
- The dropdown has only 1-2 options and they're clearly system constants (like "Yes/No" for a system toggle)

${metadata.dropdownOptions && metadata.dropdownOptions.length > 0 
  ? `\nIMPORTANT: This dropdown has ${metadata.dropdownOptions.length} options. This is a clear indicator it's a VARIABLE.\n` 
  : ''}

`;
    } else {
      prompt += `ANALYZE THIS SELECTION:

This is a click on a selectable option (radio button, checkbox).
Compare the before/after screenshots to see what option was selected.

A selection is likely a VARIABLE if:
- It's a user preference that could change (e.g., "Select Plan: Pro")
- It's a category selection that varies per use case
- It's a filter or sort option
- The selection represents user choice rather than navigation

A selection is likely STATIC if:
- It's a navigation button (Next, Submit, Continue)
- It's a fixed system setting
- It's enabling/disabling a feature that's always the same

`;
    }
  }

  if (metadata.isDropdown) {
    prompt += `RESPOND WITH JSON:
{
  "isVariable": <true or false>,
  "confidence": <0.0 to 1.0>,
  "fieldName": "<human-readable field name from visual analysis>",
  "variableName": "<camelCase variable name suggestion>",
  "reasoning": "<brief explanation of why this is/isn't a variable>",
  "options": ["<option1>", "<option2>", ...]
}

CRITICAL INSTRUCTIONS:
- **NUMBERS IN INPUT FIELDS ARE ALMOST ALWAYS VARIABLES** - Use confidence 0.8+ for numbers
- **Field labels with "Amount", "Budget", "Price", "Percentage" = VARIABLE** - Use confidence 0.9+
- **DROPDOWNS WITH MULTIPLE OPTIONS ARE ALMOST ALWAYS VARIABLES** - Use confidence 0.9+ for dropdowns
- **When in doubt, mark as VARIABLE** - It's better to detect too many than too few
- Higher confidence (0.8-1.0) for: numbers, amounts, budgets, prices, percentages, emails, names, dates, dropdowns
- Medium confidence (0.6-0.8) for: other user-entered text fields
- **DO NOT be overly conservative** - If it's something a user typed or selected, it's likely a variable
- **Default to VARIABLE for any user-entered data or selections** unless clearly a system constant
- For dropdowns: Extract ALL visible options from the dropdown menu in the screenshot
- Include the currently selected option in the options array
`;
  } else {
    prompt += `RESPOND WITH JSON:
{
  "isVariable": <true or false>,
  "confidence": <0.0 to 1.0>,
  "fieldName": "<human-readable field name from visual analysis>",
  "variableName": "<camelCase variable name suggestion>",
  "reasoning": "<brief explanation of why this is/isn't a variable>"
}

CRITICAL INSTRUCTIONS FOR FIELD NAMING:
${metadata.columnHeader 
  ? `- **USE THE COLUMN HEADER "${metadata.columnHeader}" AS THE FIELD NAME**` 
  : ''}
${metadata.columnHeader 
  ? `- fieldName should be "${metadata.columnHeader}" or a variation of it` 
  : ''}
${metadata.columnHeader 
  ? `- variableName should be camelCase version of "${metadata.columnHeader}" (e.g., "${metadata.columnHeader.toLowerCase().replace(/\s+/g, '')}")` 
  : ''}
${metadata.cellReference 
  ? `\n**🚫 ABSOLUTELY FORBIDDEN FOR SPREADSHEET CELLS:**\n- fieldName MUST NEVER be "${metadata.cellReference}" or any cell reference (e.g., "A74", "B75", "C66")\n- fieldName MUST NEVER be just the column letter (e.g., "A", "B", "C")\n- fieldName MUST be the ACTUAL COLUMN HEADER TEXT (e.g., "Name", "Email", "Price", "Marketplace Fee")\n${!initialFullPageSnapshot || !shouldIncludeSnapshot 
  ? `- ⚠️ WARNING: Full page snapshot is NOT available, so you cannot read the column header from the image\n- In this case, use a generic descriptive name like "Column ${metadata.cellReference.charAt(0)} Value" or "Unknown Field"\n- NEVER use "${metadata.cellReference}" or "${metadata.cellReference.charAt(0)}" as the fieldName\n`
  : `- ✅ Full page snapshot IS available - you MUST read the actual column header text from the image\n- Examine the snapshot carefully to find the header row and read the COMPLETE header text for column ${metadata.cellReference.charAt(0)}\n`}\n` 
  : ''}
${initialFullPageSnapshot && (pageContext?.pageType === 'data_table' || metadata.cellReference)
  ? `
🎯 **SPREADSHEET MODE: FULL PAGE SNAPSHOT PROVIDED**
- **The page was refreshed at recording start, so headers are visible in the snapshot**
- **YOU MUST EXAMINE THE FULL PAGE SNAPSHOT IMAGE TO INTELLIGENTLY SEARCH FOR THE COLUMN HEADER**
- The snapshot shows the entire spreadsheet including column headers
- INTELLIGENTLY find the header row (could be row 1, 2, 3, or any row - SEARCH for it visually)
- Identify which row contains headers by looking for descriptive labels (not data values)
- Extract column ${metadata.cellReference ? metadata.cellReference.charAt(0) : 'N/A'} header text from the header row you found
- Read the COMPLETE, ACTUAL header text from the image (e.g., "Marketplace Fee", "Store UUID", "ORG ID", "Price per Unit")
- Read ALL words in the header - if header says "Marketplace Fee", use "Marketplace Fee" NOT just "Marketplace"
- Use that EXACT, COMPLETE header text as the fieldName - DO NOT use "Cell ${metadata.cellReference || 'N/A'}" or "Column ${metadata.cellReference ? metadata.cellReference.charAt(0) : 'N/A'}"
- DO NOT truncate multi-word headers - read the FULL text
- The column header text from the snapshot is MORE ACCURATE than any other metadata
- If not all columns are visible, read the headers that ARE visible with their COMPLETE text
`
  : ''}
${initialFullPageSnapshot && (pageContext?.pageType === 'data_table' || metadata.cellReference)
  ? `\n🎯 **SPREADSHEET MODE: FULL PAGE SNAPSHOT PROVIDED**\n`
  : ''}
${initialFullPageSnapshot && (pageContext?.pageType === 'data_table' || metadata.cellReference)
  ? `- **YOU MUST EXAMINE THE FULL PAGE SNAPSHOT IMAGE TO INTELLIGENTLY FIND THE COLUMN HEADER**\n`
  : ''}
${initialFullPageSnapshot && (pageContext?.pageType === 'data_table' || metadata.cellReference)
  ? `- Look at the full page snapshot and INTELLIGENTLY find the header row (could be any row, not just row 1)\n`
  : ''}
${initialFullPageSnapshot && (pageContext?.pageType === 'data_table' || metadata.cellReference)
  ? `- Identify which row contains headers by looking for descriptive labels (not data values)\n`
  : ''}
${initialFullPageSnapshot && (pageContext?.pageType === 'data_table' || metadata.cellReference)
  ? `- Extract the header text for column ${metadata.cellReference ? metadata.cellReference.charAt(0) : 'N/A'} from the header row you found\n`
  : ''}
${initialFullPageSnapshot && (pageContext?.pageType === 'data_table' || metadata.cellReference)
  ? `- Use the actual header text as the field name - it takes HIGHEST PRIORITY over all other metadata\n`
  : ''}
${initialFullPageSnapshot && (pageContext?.pageType === 'data_table' || metadata.cellReference)
  ? `- Remember: Page was refreshed, so headers are visible. SEARCH for them intelligently, don't assume row 1.\n`
  : ''}
${!metadata.columnHeader && !initialFullPageSnapshot
  ? '- If columnHeader is not provided and no full page snapshot, use field label or visual analysis'
  : ''}
- If columnHeader is provided, prioritize it over field label or placeholder
- Higher confidence (0.8+) for clear cases like email, password, name fields
- Medium confidence (0.5-0.8) for ambiguous cases
- Lower confidence (<0.5) if unsure - lean toward NOT marking as variable
`;
  }

  return prompt;
}

/**
 * Parse Gemini response into VariableDefinition
 */
function parseVariableResponse(
  geminiData: any,
  metadata: StepMetadata,
  shouldIncludeSnapshot: boolean = false,
  initialFullPageSnapshot?: string
): VariableDefinition | null {
  try {
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Log raw response for debugging
    console.log(`[detect_variables] Raw Gemini response for step ${metadata.stepIndex} (first 500 chars):`, text.substring(0, 500));
    
    // Try to extract JSON from markdown code blocks first
    let jsonText = '';
    
    // First, try to find content between ``` markers (handles incomplete blocks too)
    const codeBlockStart = text.indexOf('```');
    if (codeBlockStart !== -1) {
      // Find the content after ```json or ```
      const afterStart = text.substring(codeBlockStart + 3);
      const jsonStart = afterStart.match(/^(?:json)?\s*\n?(\{)/);
      if (jsonStart) {
        // Extract everything from the opening { to the end
        const startIdx = jsonStart.index! + jsonStart[0].length - 1;
        let extracted = afterStart.substring(startIdx);
        
        // Try to find a complete JSON object first
        let braceCount = 0;
        let jsonEnd = -1;
        let inString = false;
        let escapeNext = false;
        
        for (let i = 0; i < extracted.length; i++) {
          const char = extracted[i];
          
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          
          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }
          
          if (!inString) {
            if (char === '{') braceCount++;
            if (char === '}') {
              braceCount--;
              if (braceCount === 0) {
                jsonEnd = i + 1;
                break;
              }
            }
          }
        }
        
        if (jsonEnd > 0) {
          // Found complete JSON
          jsonText = extracted.substring(0, jsonEnd);
          console.log(`[detect_variables] Found complete JSON in code block for step ${metadata.stepIndex}`);
        } else {
          // JSON is incomplete - try to fix it
          console.log(`[detect_variables] JSON appears incomplete, attempting to fix for step ${metadata.stepIndex}`);
          
          // Find the last complete property (ending with , or })
          // Look for patterns like: "key": value, or "key": value}
          const lastCommaMatch = extracted.match(/,\s*"[^"]*":\s*"[^"]*$/);
          const lastCompletePropMatch = extracted.match(/,\s*"[^"]*":\s*[^,}]+$/);
          
          if (lastCommaMatch || lastCompletePropMatch) {
            // Find the position of the last comma before an incomplete property
            let lastCommaIdx = -1;
            inString = false;
            escapeNext = false;
            
            for (let i = extracted.length - 1; i >= 0; i--) {
              const char = extracted[i];
              
              if (escapeNext) {
                escapeNext = false;
                continue;
              }
              
              if (char === '\\') {
                escapeNext = true;
                continue;
              }
              
              if (char === '"' && !escapeNext) {
                inString = !inString;
                continue;
              }
              
              if (!inString && char === ',') {
                // Check if this comma is followed by an incomplete property
                const afterComma = extracted.substring(i + 1).trim();
                if (afterComma.match(/^"[^"]*":\s*"[^"]*$/)) {
                  // This is an incomplete property, use everything before this comma
                  lastCommaIdx = i;
                  break;
                }
              }
            }
            
            if (lastCommaIdx > 0) {
              jsonText = extracted.substring(0, lastCommaIdx) + '}';
              console.log(`[detect_variables] Fixed incomplete JSON by removing last property for step ${metadata.stepIndex}`);
            } else {
              // Try to find the last complete property by looking for the pattern "key": value,
              const completeMatch = extracted.match(/^(.+),\s*"[^"]*":\s*"[^"]*$/);
              if (completeMatch) {
                jsonText = completeMatch[1] + '}';
                console.log(`[detect_variables] Fixed incomplete JSON by removing incomplete property for step ${metadata.stepIndex}`);
              } else {
                // Last resort: just close the object
                jsonText = extracted.trim();
                // Remove any incomplete property at the end
                // Handle cases like: ", "} or ", "variableName": " or ", "variableName": "
                // First, handle the specific case of trailing ", "} (comma, space, quote, closing brace)
                if (jsonText.endsWith(', "}')) {
                  jsonText = jsonText.replace(/,\s*"\s*}$/, '}');
                } else if (jsonText.match(/,\s*"[^"]*":\s*"[^"]*"\s*}$/)) {
                  // Handle case like: ", "variableName": "value" }
                  jsonText = jsonText.replace(/,\s*"[^"]*":\s*"[^"]*"\s*}$/, '}');
                } else {
                  // Try to find and remove the last incomplete property
                  // The incomplete property is the one that extends to the end without a closing quote
                  // We need to find the LAST comma that's followed by an incomplete property
                  // Pattern: , "key": "value (no closing quote, extends to end)
                  
                  // First, try to find the incomplete property by looking for patterns like: "key": "value (no closing quote)
                  // We want to preserve all complete properties and only remove the incomplete one
                  let lastIncompletePropStart = -1;
                  let lastIncompletePropName = '';
                  
                  // Look for pattern: , "key": "value (incomplete - no closing quote before end or })
                  // Search backwards from the end
                  for (let i = jsonText.length - 1; i >= 0; i--) {
                    if (jsonText[i] === ',') {
                      // Check if this comma starts an incomplete property
                      const afterComma = jsonText.substring(i + 1).trim();
                      // Match incomplete property: "key": "value (no closing quote)
                      const incompleteMatch = afterComma.match(/^"([^"]+)":\s*"([^"]*)$/);
                      if (incompleteMatch) {
                        // Check if this property is incomplete (no closing quote before } or end)
                        const propValue = incompleteMatch[2];
                        // If the value doesn't have a closing quote and extends to the end, it's incomplete
                        if (!propValue.includes('"') || jsonText.substring(i + 1).trim().endsWith('"')) {
                          // This might be complete, check if there's a closing quote after the value
                          const fullProp = jsonText.substring(i + 1);
                          if (!fullProp.match(/^"([^"]+)":\s*"[^"]*"\s*[,}]/)) {
                            // No closing quote before comma or }, so it's incomplete
                            lastIncompletePropStart = i + 1;
                            lastIncompletePropName = incompleteMatch[1];
                            break;
                          }
                        } else {
                          // Has quotes but might still be incomplete if it extends to end
                          const remaining = jsonText.substring(i + 1);
                          if (!remaining.match(/^"([^"]+)":\s*"[^"]*"\s*[,}]/)) {
                            lastIncompletePropStart = i + 1;
                            lastIncompletePropName = incompleteMatch[1];
                            break;
                          }
                        }
                      }
                    }
                  }
                  
                  if (lastIncompletePropStart >= 0) {
                    // Remove only the incomplete property, preserve everything before it
                    // Find the comma before the incomplete property
                    const beforeProp = jsonText.substring(0, lastIncompletePropStart).trim();
                    // Remove trailing comma if present
                    const cleaned = beforeProp.replace(/,\s*$/, '');
                    jsonText = cleaned + '}';
                    console.log(`[detect_variables] Removed incomplete property "${lastIncompletePropName}" for step ${metadata.stepIndex}`);
                  } else {
                    // Try other patterns
                    jsonText = jsonText.replace(/,\s*"[^"]*":\s*"[^"]*"\s*$/, ''); // Remove incomplete property with complete string but trailing
                    jsonText = jsonText.replace(/,\s*"[^"]*":\s*$/, ''); // Remove incomplete property key
                    jsonText = jsonText.replace(/,\s*"[^"]*"\s*$/, ''); // Remove incomplete string value
                    jsonText = jsonText.replace(/,\s*"[^"]*$/, ''); // Remove incomplete string
                    jsonText = jsonText.replace(/,\s*"$/, ''); // Remove trailing comma and quote
                    jsonText = jsonText.replace(/,\s*$/, ''); // Remove trailing comma
                    if (!jsonText.endsWith('}')) {
                      jsonText += '}';
                    }
                  }
                }
                console.log(`[detect_variables] Fixed incomplete JSON by closing object for step ${metadata.stepIndex}`);
              }
            }
          } else {
            // No clear pattern, try to close it
            jsonText = extracted.trim();
            // Remove trailing incomplete string or property
            // Handle cases like: ", "} or ", "variableName": " or ", "variableName": "
            // First, handle the specific case of trailing ", "} (comma, space, quote, closing brace)
            if (jsonText.endsWith(', "}')) {
              jsonText = jsonText.replace(/,\s*"\s*}$/, '}');
            } else if (jsonText.match(/,\s*"[^"]*":\s*"[^"]*"\s*}$/)) {
              // Handle case like: ", "variableName": "value" }
              jsonText = jsonText.replace(/,\s*"[^"]*":\s*"[^"]*"\s*}$/, '}');
            } else {
              // Try to find and remove the last incomplete property
              // The incomplete property is the one that extends to the end without a closing quote
              // We need to find the LAST comma that's followed by an incomplete property
              
              // Find the incomplete property by looking for patterns like: "key": "value (no closing quote)
              // We want to preserve all complete properties and only remove the incomplete one
              let lastIncompletePropStart = -1;
              let lastIncompletePropName = '';
              
              // Look for pattern: , "key": "value (incomplete - no closing quote before end or })
              // Search backwards from the end
              for (let i = jsonText.length - 1; i >= 0; i--) {
                if (jsonText[i] === ',') {
                  // Check if this comma starts an incomplete property
                  const afterComma = jsonText.substring(i + 1).trim();
                  // Match incomplete property: "key": "value (no closing quote)
                  const incompleteMatch = afterComma.match(/^"([^"]+)":\s*"([^"]*)$/);
                  if (incompleteMatch) {
                    // Check if this property is incomplete (no closing quote before } or end)
                    const remaining = jsonText.substring(i + 1);
                    if (!remaining.match(/^"([^"]+)":\s*"[^"]*"\s*[,}]/)) {
                      lastIncompletePropStart = i + 1;
                      lastIncompletePropName = incompleteMatch[1];
                      break;
                    }
                  }
                }
              }
              
              if (lastIncompletePropStart >= 0) {
                // Remove only the incomplete property, preserve everything before it
                // Find the comma before the incomplete property
                const beforeProp = jsonText.substring(0, lastIncompletePropStart).trim();
                // Remove trailing comma if present
                const cleaned = beforeProp.replace(/,\s*$/, '');
                jsonText = cleaned + '}';
                console.log(`[detect_variables] Removed incomplete property "${lastIncompletePropName}" (fallback) for step ${metadata.stepIndex}`);
              } else {
                // Try other patterns
                jsonText = jsonText.replace(/,\s*"[^"]*":\s*"[^"]*"\s*$/, ''); // Remove incomplete property with complete string but trailing
                jsonText = jsonText.replace(/,\s*"[^"]*":\s*$/, ''); // Remove incomplete property key
                jsonText = jsonText.replace(/,\s*"[^"]*"\s*$/, ''); // Remove incomplete string value
                jsonText = jsonText.replace(/,\s*"[^"]*$/, ''); // Remove incomplete string
                jsonText = jsonText.replace(/,\s*"$/, ''); // Remove trailing comma and quote
                jsonText = jsonText.replace(/,\s*$/, ''); // Remove trailing comma
                if (!jsonText.endsWith('}')) {
                  jsonText += '}';
                }
              }
            }
            console.log(`[detect_variables] Fixed incomplete JSON by closing object (fallback) for step ${metadata.stepIndex}`);
          }
        }
      }
    }
    
    // If no code block match, try to find JSON object directly in text
    if (!jsonText) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error(`[detect_variables] No JSON found in Gemini response for step ${metadata.stepIndex}`);
        console.error(`[detect_variables] Full response text (first 1000 chars):`, text.substring(0, 1000));
        return null;
      }
      jsonText = jsonMatch[0];
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseError) {
      console.error(`[detect_variables] Failed to parse JSON for step ${metadata.stepIndex}:`, parseError);
      console.error(`[detect_variables] JSON text (first 500 chars):`, jsonText.substring(0, 500));
      
      // Try to extract fieldName from raw text as fallback
      const fieldNameMatch = text.match(/"fieldName":\s*"([^"]+)"/);
      if (fieldNameMatch && fieldNameMatch[1]) {
        console.log(`[detect_variables] Extracted fieldName from raw text: "${fieldNameMatch[1]}"`);
        parsed = {
          isVariable: text.includes('"isVariable":\s*true'),
          confidence: parseFloat(text.match(/"confidence":\s*([\d.]+)/)?.[1] || '0.5'),
          fieldName: fieldNameMatch[1],
          reasoning: text.match(/"reasoning":\s*"([^"]+)"/)?.[1],
        };
      } else {
        return null;
      }
    }

    // Log the AI response for debugging
    console.log(`[detect_variables] Step ${metadata.stepIndex} AI response:`, {
      isVariable: parsed.isVariable,
      confidence: parsed.confidence,
      fieldName: parsed.fieldName,
      reasoning: parsed.reasoning,
      value: metadata.value,
      label: metadata.label,
    });

    // Parse the response
    const isVariable = parsed.isVariable === true;
    const confidence = parseFloat(parsed.confidence) || 0;

    // Check if diagnostic fields are missing (indicates AI may not have read snapshot properly)
    const hasDiagnostics = !!(parsed.imageDescription && parsed.headerRowPosition && parsed.headersFound);
    if (!hasDiagnostics && shouldIncludeSnapshot && initialFullPageSnapshot) {
      console.warn(`[detect_variables] ⚠️ Step ${metadata.stepIndex}: Diagnostic fields missing! AI may not have read snapshot properly.`, {
        hasImageDescription: !!parsed.imageDescription,
        hasHeaderRowPosition: !!parsed.headerRowPosition,
        hasHeadersFound: !!parsed.headersFound,
        fieldName: parsed.fieldName,
        message: 'AI did not provide required diagnostic fields (imageDescription, headerRowPosition, headersFound). This suggests the AI did not examine the snapshot.',
      });
    }
    
    // CRITICAL: Log the AI's raw response for spreadsheet steps
    if (metadata.cellReference) {
      console.log(`[detect_variables] Step ${metadata.stepIndex} AI raw response:`, {
        fieldName: parsed.fieldName,
        cellReference: metadata.cellReference,
        hasSnapshot: shouldIncludeSnapshot,
        imageDescription: parsed.imageDescription?.substring(0, 100) || 'NOT PROVIDED',
        headerRowPosition: parsed.headerRowPosition || 'NOT PROVIDED',
        headersFound: parsed.headersFound?.substring(0, 200) || 'NOT PROVIDED',
      });
    }

    // Post-processing: Check if fieldName is a partial header (e.g., "Marketplace" when it should be "Marketplace Fee")
    let finalFieldName = parsed.fieldName || metadata.label || 'Unknown Field';
    if (parsed.headersFound && parsed.fieldName && shouldIncludeSnapshot && metadata.cellReference) {
      const columnLetter = metadata.cellReference.charAt(0);
      const headersFound = parsed.headersFound.toLowerCase();
      const fieldNameLower = parsed.fieldName.toLowerCase();
      
      // Look for column header in headersFound that starts with fieldName but is longer
      // Pattern: "Column X: [header text]" where header text starts with fieldName
      const columnPattern = new RegExp(`column\\s+${columnLetter.toLowerCase()}\\s*:\\s*([^,]+)`, 'i');
      const match = parsed.headersFound.match(columnPattern);
      
      if (match && match[1]) {
        const fullHeaderText = match[1].trim();
        const fullHeaderLower = fullHeaderText.toLowerCase();
        
        // If full header starts with fieldName but is longer, use the full header
        if (fullHeaderLower.startsWith(fieldNameLower) && fullHeaderText.length > parsed.fieldName.length) {
          console.log(`[detect_variables] 🔧 Step ${metadata.stepIndex}: Detected partial header. Fixing "${parsed.fieldName}" → "${fullHeaderText}"`);
          finalFieldName = fullHeaderText;
        } else if (fullHeaderLower !== fieldNameLower && fullHeaderText.length > 0) {
          // If headersFound has a different (likely complete) header, use it
          console.log(`[detect_variables] 🔧 Step ${metadata.stepIndex}: Using complete header from headersFound: "${fullHeaderText}" (was: "${parsed.fieldName}")`);
          finalFieldName = fullHeaderText;
        }
      }
    }

    console.log(`[detect_variables] Parsed AI response for step ${metadata.stepIndex}:`, {
      parsedIsVariable: parsed.isVariable,
      parsedConfidence: parsed.confidence,
      isVariable,
      confidence,
      fieldName: parsed.fieldName,
      finalFieldName,
      imageDescription: parsed.imageDescription || 'NOT PROVIDED',
      rowsVisible: parsed.rowsVisible || 'NOT PROVIDED',
      headerRowPosition: parsed.headerRowPosition || 'NOT PROVIDED',
      headersFound: parsed.headersFound || 'NOT PROVIDED',
      reasoning: parsed.reasoning,
      hasDiagnostics,
    });

    const result: VariableDefinition = {
      stepIndex: metadata.stepIndex,
      stepId: metadata.stepId,
      fieldName: finalFieldName,
      fieldLabel: metadata.label,
      variableName: parsed.variableName || generateVariableName(parsed.fieldName || metadata.label),
      defaultValue: metadata.value || '',
      inputType: metadata.inputType,
      isVariable,
      confidence,
      reasoning: parsed.reasoning,
      // Preserve spreadsheet context for intelligent column-based targeting
      columnHeader: metadata.columnHeader || finalFieldName, // Use columnHeader if available, else fieldName
      cellReference: metadata.cellReference,
    };

    // Add dropdown-specific fields
    if (metadata.isDropdown) {
      result.isDropdown = true;
      // Use AI-extracted options if available, otherwise use DOM options
      if (parsed.options && Array.isArray(parsed.options) && parsed.options.length > 0) {
        result.options = parsed.options;
      } else if (metadata.dropdownOptions && metadata.dropdownOptions.length > 0) {
        result.options = metadata.dropdownOptions;
      }
    }

    return result;
  } catch (error) {
    console.error('Error parsing variable response:', error);
    return null;
  }
}

/**
 * Check fallback heuristic for variable detection
 * Returns a VariableDefinition if heuristic matches, null otherwise
 */
function checkFallbackHeuristic(metadata: StepMetadata): VariableDefinition | null {
  const isInputStep = metadata.stepType === 'INPUT' || metadata.stepType === 'KEYBOARD';
  const isClickStep = metadata.stepType === 'CLICK';
  const hasValue = !!metadata.value;
  
  // Handle INPUT steps
  if (isInputStep && hasValue) {
    const valueStr = String(metadata.value).trim();
    const isNumber = /^\d+(\.\d+)?$/.test(valueStr);
    const hasVariableKeyword = metadata.label && /(amount|budget|price|percentage|quantity|number|rate|fee|total|value|count|name|email|phone|address|date|time)/i.test(metadata.label);
    const shouldBeVariable = isNumber || hasVariableKeyword;
    
    console.log(`[detect_variables] Fallback check for INPUT step ${metadata.stepIndex}:`, {
      value: metadata.value,
      valueStr,
      isNumber,
      hasVariableKeyword,
      label: metadata.label,
      shouldBeVariable,
    });
    
    if (shouldBeVariable) {
      return {
        stepIndex: metadata.stepIndex,
        stepId: metadata.stepId,
        fieldName: metadata.label || 'Unknown Field',
        fieldLabel: metadata.label,
        variableName: generateVariableName(metadata.label || 'field'),
        defaultValue: metadata.value || '',
        inputType: metadata.inputType,
        isVariable: true,
        confidence: 0.85, // High confidence for fallback since it's a clear case
        reasoning: isNumber 
          ? `Detected via fallback heuristic: number "${metadata.value}" in input field "${metadata.label || 'field'}"`
          : `Detected via fallback heuristic: variable keyword in label "${metadata.label}"`,
      };
    }
  }
  
  // Handle CLICK steps (dropdowns)
  // Check both metadata.isDropdown AND selector for role="option" patterns
  const selector = metadata.selector || '';
  const looksLikeDropdown = metadata.isDropdown || 
                            selector.includes('role="option"') ||
                            selector.includes("role='option'") ||
                            selector.includes('[role="option"]') ||
                            selector.includes("[role='option']") ||
                            selector.includes('listbox');
  
  if (isClickStep && looksLikeDropdown) {
    const hasOptions = metadata.dropdownOptions && metadata.dropdownOptions.length > 0;
    const hasValue = !!metadata.value;
    
    console.log(`[detect_variables] Fallback check for DROPDOWN CLICK step ${metadata.stepIndex}:`, {
      isDropdown: metadata.isDropdown,
      looksLikeDropdown,
      selector: selector.substring(0, 100),
      hasOptions,
      hasValue,
      value: metadata.value,
      label: metadata.label,
      options: metadata.dropdownOptions,
    });
    
    // Dropdowns are almost always variables (user selects different options)
    // Even without value/options, if selector shows it's a dropdown option, mark as variable
    if (hasValue || hasOptions || looksLikeDropdown) {
      // Extract value from selector if available (e.g., "BOGO" from selector)
      let defaultValue = metadata.value;
      if (!defaultValue && selector) {
        // Try to extract the option text from the selector (e.g., 'BOGO' from contains(..., 'BOGO'))
        const valueMatch = selector.match(/contains\([^,]+,\s*['"]([^'"]+)['"]\)/);
        if (valueMatch && valueMatch[1]) {
          defaultValue = valueMatch[1];
        }
      }
      
      return {
        stepIndex: metadata.stepIndex,
        stepId: metadata.stepId,
        fieldName: metadata.label || 'Dropdown Selection',
        fieldLabel: metadata.label,
        variableName: generateVariableName(metadata.label || 'dropdown'),
        defaultValue: defaultValue || (hasOptions ? metadata.dropdownOptions![0] : ''),
        inputType: metadata.inputType,
        isVariable: true,
        isDropdown: true,
        options: metadata.dropdownOptions,
        confidence: 0.9, // Very high confidence - dropdowns are almost always variables
        reasoning: `Detected via fallback heuristic: dropdown selection (selector contains role="option")`,
      };
    }
  }
  
  return null;
}

/**
 * Generate a camelCase variable name from a field name
 */
function generateVariableName(fieldName: string): string {
  if (!fieldName) return 'field';
  
  return fieldName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .map((word, index) => 
      index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join('');
}

/**
 * Generate cache key for the request
 */
function generateCacheKey(payload: DetectVariablesRequest): string {
  // Create a hash based on step metadata and page context
  // NOTE: We intentionally EXCLUDE initialFullPageSnapshot from cache key
  // because the snapshot is large and we want to cache based on steps only
  // The snapshot will be used during analysis even if cache is hit
  const keyData = {
    type: 'detect_variables',
    stepCount: payload.steps.length,
    stepIds: payload.steps.map(s => s.metadata.stepId).join(','),
    pageUrl: payload.pageContext?.url?.substring(0, 100),
    // Intentionally NOT including initialFullPageSnapshot in cache key
    // to allow snapshot to be used even with cached results
  };
  
  const str = JSON.stringify(keyData);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `detect_variables_${Math.abs(hash).toString(36)}`;
}

/**
 * Check cache for existing result
 */
async function checkCache(
  supabase: any,
  cacheKey: string
): Promise<DetectVariablesResponse | null> {
  try {
    const { data, error } = await supabase
      .from('ai_cache')
      .select('response_data, expires_at')
      .eq('cache_key', cacheKey)
      .single();

    if (error || !data) {
      return null;
    }

    if (new Date(data.expires_at) < new Date()) {
      await supabase.from('ai_cache').delete().eq('cache_key', cacheKey);
      return null;
    }

    return data.response_data as DetectVariablesResponse;
  } catch (e) {
    console.error('Cache check error:', e);
    return null;
  }
}

/**
 * Save result to cache
 */
async function saveToCache(
  supabase: any,
  cacheKey: string,
  result: DetectVariablesResponse,
  ttlSeconds: number = 1800
): Promise<void> {
  try {
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + ttlSeconds);

    await supabase
      .from('ai_cache')
      .upsert({
        cache_key: cacheKey,
        response_data: result,
        expires_at: expiresAt.toISOString(),
      });
  } catch (e) {
    console.error('Cache save error:', e);
  }
}

/**
 * Extract base64 data from data URL
 */
function extractBase64Data(dataUrl: string): string {
  const base64Match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
  return base64Match ? base64Match[1] : dataUrl;
}

// NOTE: Removed inferFieldFromValue function - users will rename variables in the UI instead
