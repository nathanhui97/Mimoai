/**
 * Supabase Edge Function: generate_step_description
 * Generates natural language descriptions for workflow steps using Gemini API
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

interface StepDescriptionPayload {
  step: {
    type: string;
    payload: {
      selector?: string;
      label?: string;
      value?: string;
      elementText?: string;
      url?: string;
      elementRole?: string;
      visualSnapshot?: {
        elementSnippet?: string; // Base64 data URL
        viewport?: string; // Base64 data URL
      };
      viewport?: {
        width?: number;
        height?: number;
        scrollX?: number;
        scrollY?: number;
      };
      context?: {
        container?: { text?: string; type?: string };
        parent?: { text?: string; attributes?: { role?: string } };
        buttonContext?: { label?: string; section?: string };
        decisionSpace?: {
          type: string;
          options: string[];
          selectedIndex?: number;
          selectedText?: string;
        };
        siblings?: { before?: string[]; after?: string[] };
        surroundingText?: string;
      };
      aiEvidence?: {
        semanticAnchors?: {
          textLabel?: string;
          ariaLabel?: string;
          nearbyText?: string[];
        };
      };
      disambiguators?: string[];
    };
  };
}

interface StepDescriptionResult {
  description: string;
  confidence: number;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  try {
    // Parse request
    const payload: StepDescriptionPayload = await req.json();

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    // Check cache first
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const cacheKey = generateCacheKey(payload);
    
    // CRITICAL: For widget clicks with visual snapshots but NO decisionSpace (not menu items),
    // skip cache to ensure each widget gets a fresh description based on its visual snapshot
    // Widget clicks with the same selector pattern but different visual snapshots should NOT share cache
    const hasVisualSnapshot = !!payload.step.payload.visualSnapshot?.elementSnippet;
    const hasDecisionSpace = !!payload.step.payload.context?.decisionSpace;
    const isWidgetClick = payload.step.payload.selector?.includes('gs-report-widget-element') || 
                          payload.step.payload.selector?.includes('widget-element');
    
    // Skip cache for widget clicks that have visual snapshots but no decisionSpace
    // These are widget clicks (not menu items) and should be analyzed fresh based on the visual snapshot
    // to identify the specific widget title
    if (hasVisualSnapshot && isWidgetClick && !hasDecisionSpace) {
      console.log('Skipping cache for widget click with visual snapshot (will analyze fresh to identify specific widget)');
      // Don't check cache - go straight to AI analysis
    } else {
      // For menu items (with decisionSpace) or non-widget clicks, use cache normally
      const cached = await checkCache(supabase, cacheKey);
      if (cached) {
        console.log('Cache hit for:', cacheKey);
        return new Response(JSON.stringify(cached), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    }

    // Log what we're receiving
    console.log('Step type:', payload.step.type);
    console.log('Has visual snapshot:', !!payload.step.payload.visualSnapshot?.elementSnippet);
    console.log('Has decisionSpace:', !!payload.step.payload.context?.decisionSpace);
    console.log('Element text:', payload.step.payload.elementText);
    console.log('Label:', payload.step.payload.label);
    console.log('Container context:', payload.step.payload.context?.container?.text || 'NONE');
    console.log('Container type:', payload.step.payload.context?.container?.type || 'NONE');
    console.log('Parent text:', payload.step.payload.context?.parent?.text || 'NONE');
    console.log('Aria label:', payload.step.payload.aiEvidence?.semanticAnchors?.ariaLabel || 'NONE');
    console.log('Text label:', payload.step.payload.aiEvidence?.semanticAnchors?.textLabel || 'NONE');
    console.log('Nearby text:', payload.step.payload.aiEvidence?.semanticAnchors?.nearbyText || 'NONE');
    console.log('Disambiguators:', payload.step.payload.disambiguators || 'NONE');
    
    // Build prompt from step
    const prompt = buildPrompt(payload);

    // Build Gemini API request with image support
    const parts: any[] = [{ text: prompt }];
    
    // Add visual snapshot if available (Gemini supports base64 images)
    if (payload.step.payload.visualSnapshot?.elementSnippet) {
      const imageData = payload.step.payload.visualSnapshot.elementSnippet;
      // Extract base64 data (remove data:image/png;base64, prefix if present)
      const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;
      
      parts.push({
        inline_data: {
          mime_type: imageData.includes('jpeg') ? 'image/jpeg' : 'image/png',
          data: base64Data
        }
      });
      console.log('Including element snapshot in description generation (size:', base64Data.length, 'chars)');
    } else {
      console.warn('No visual snapshot available - descriptions may be less accurate');
    }

    const geminiRequest: any = {
      contents: [{
        parts: parts
      }]
    };

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
    const result = parseGeminiResponse(geminiData, payload);

    // Cache the result
    await saveToCache(supabase, cacheKey, result);

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error in generate_step_description:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        description: 'Action performed',
        confidence: 0
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
 * Generate cache key from payload
 * Include visual snapshot hash to differentiate similar steps
 */
function generateCacheKey(payload: StepDescriptionPayload): string {
  // For widget clicks, use more of the visual snapshot to differentiate between different widgets
  // Use first 500 chars (instead of 200) to better differentiate widgets with similar selectors
  const snapshotHash = payload.step.payload.visualSnapshot?.elementSnippet?.substring(0, 500) ||
                      payload.step.payload.visualSnapshot?.viewport?.substring(0, 500);
  
  const keyData = {
    type: 'step_description',
    stepType: payload.step.type,
    selector: payload.step.payload.selector,
    label: payload.step.payload.label,
    value: payload.step.payload.value,
    elementText: payload.step.payload.elementText,
    // Include decisionSpace to differentiate dropdown selections
    selectedText: payload.step.payload.context?.decisionSpace?.selectedText,
    selectedIndex: payload.step.payload.context?.decisionSpace?.selectedIndex,
    // Include container context to differentiate same element in different widgets
    containerText: payload.step.payload.context?.container?.text,
    // Include snapshot hash (first 500 chars) to differentiate visually different elements
    // Increased from 200 to 500 for better differentiation of widgets with similar selectors
    snapshotHash: snapshotHash,
    // Include element bounds to differentiate widgets at different positions
    elementBounds: payload.step.payload.elementBounds ? 
      `${payload.step.payload.elementBounds.x},${payload.step.payload.elementBounds.y},${payload.step.payload.elementBounds.width},${payload.step.payload.elementBounds.height}` : 
      undefined,
  };
  
  const str = JSON.stringify(keyData);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `step_description_${Math.abs(hash).toString(36)}`;
}

/**
 * Check cache
 */
async function checkCache(supabase: any, cacheKey: string): Promise<StepDescriptionResult | null> {
  try {
    const { data, error } = await supabase
      .from('ai_cache')
      .select('response_data, expires_at')
      .eq('cache_key', cacheKey)
      .single();

    if (error || !data) {
      return null;
    }

    // Check if expired
    if (new Date(data.expires_at) < new Date()) {
      await supabase.from('ai_cache').delete().eq('cache_key', cacheKey);
      return null;
    }

    return data.response_data as StepDescriptionResult;
  } catch (e) {
    console.error('Cache check error:', e);
    return null;
  }
}

/**
 * Save to cache
 */
async function saveToCache(supabase: any, cacheKey: string, result: StepDescriptionResult): Promise<void> {
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days TTL

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
 * Build prompt from step
 */
function buildPrompt(payload: StepDescriptionPayload): string {
  const step = payload.step;
  const hasVisualSnapshot = !!step.payload.visualSnapshot?.elementSnippet;
  
  // PRIORITY 1: Visual snapshot is PRIMARY source of truth
  let prompt = hasVisualSnapshot ? 
    `🎯 PRIMARY INSTRUCTION: A visual snapshot of the element is provided as an image above. THIS IS YOUR PRIMARY SOURCE OF INFORMATION.\n\n` +
    `CRITICAL: Use the visual snapshot to:\n` +
    `1. Identify the EXACT UI element type (button, icon, input field, dropdown, menu item, etc.)\n` +
    `2. Read any visible text, labels, or icons directly from the image\n` +
    `3. Understand the visual context (is it in a menu? toolbar? form? table?)\n` +
    `4. Determine the specific action being performed\n` +
    `5. Note visual style (color, size, position) to distinguish from similar elements\n` +
    `6. 🎯 IDENTIFY THE SPECIFIC WIDGET/DASHBOARD: Look for widget titles, card headers, or report names visible in the image\n` +
    `   - If you see a widget title like "OFFERS EXPIRING IN NEXT 28 DAYS" or "EXPIRED OR REVOKED OFFERS", use that specific title\n` +
    `   - If you see a dashboard section like "Demand Gen", use that but also try to identify the specific widget if visible\n` +
    `   - The visual snapshot shows the actual widget context - use it to identify which specific widget was clicked\n\n` +
    `⚠️ DO NOT rely solely on text context if the visual snapshot shows something different.\n` +
    `⚠️ DO NOT use generic descriptions like "click on widget" or "click on element".\n` +
    `⚠️ DO NOT use section headers (like "Demand Gen") if you can see a specific widget title in the image.\n` +
    `✅ DO use the visual snapshot to create SPECIFIC, ACTIONABLE descriptions.\n` +
    `✅ DO describe what you actually SEE in the image, not what the text context suggests.\n` +
    `✅ DO identify the specific widget title from the screenshot if visible (e.g., "OFFERS EXPIRING IN NEXT 28 DAYS").\n\n` :
    `⚠️ WARNING: No visual snapshot available. Descriptions may be less accurate.\n` +
    `Use the text context information below, but be aware descriptions may be generic.\n\n`;
  
  // LOCATION CONTEXT: Always include widget/dashboard context (works WITH visual snapshot)
  if (step.payload.context?.container?.text) {
    prompt += `\n📍 LOCATION CONTEXT: The text context suggests the action is within "${step.payload.context.container.text}" (${step.payload.context.container.type || 'container'})\n`;
    prompt += `⚠️ IMPORTANT: If the visual snapshot shows a DIFFERENT or MORE SPECIFIC widget title, use the one from the visual snapshot instead.\n`;
    prompt += `For example, if text context says "Demand Gen" but the image shows "OFFERS EXPIRING IN NEXT 28 DAYS", use "OFFERS EXPIRING IN NEXT 28 DAYS".\n`;
    prompt += `The visual snapshot is the PRIMARY source - it shows what the user actually sees and clicks on.\n`;
    prompt += `Example: If clicking a button in a widget, say "Click [button name] in [widget title from image]" instead of just "Click [button name]"\n\n`;
  }
  
  prompt += `Step Type: ${step.type}\n\n`;
  
  // PRIMARY ELEMENT IDENTIFICATION from recorded data
  // These are the MOST RELIABLE sources for what element was clicked
  const parentText = step.payload.context?.parent?.text;
  const ariaLabel = step.payload.aiEvidence?.semanticAnchors?.ariaLabel;
  const textLabel = step.payload.aiEvidence?.semanticAnchors?.textLabel;
  const nearbyText = step.payload.aiEvidence?.semanticAnchors?.nearbyText;
  const disambiguators = step.payload.disambiguators;
  const parentRole = step.payload.context?.parent?.attributes?.role;
  
  if (parentText || ariaLabel || textLabel) {
    prompt += `\n🎯 ACTUAL ELEMENT CLICKED (from recording):\n`;
    if (ariaLabel) prompt += `  - Aria Label: "${ariaLabel}"\n`;
    if (textLabel) prompt += `  - Text Label: "${textLabel}"\n`;
    if (parentText) prompt += `  - Parent Text: "${parentText}"\n`;
    if (parentRole) prompt += `  - Parent Role: "${parentRole}"\n`;
    if (nearbyText?.length) prompt += `  - Nearby Text: ${nearbyText.slice(0, 3).join(', ')}\n`;
    if (disambiguators?.length) prompt += `  - Disambiguators: ${disambiguators.slice(0, 3).join(', ')}\n`;
    prompt += `\n⚠️ IMPORTANT: Use the ACTUAL ELEMENT info above instead of making up element names!\n`;
    prompt += `If parent text says "Show Navigation Menu", describe it as "Click navigation menu dropdown"\n`;
    prompt += `If aria label says "Search", describe it as "Click search button"\n\n`;
  }
  
  // Text context is SECONDARY (supplementary information)
  prompt += `Supplementary Text Context (use only if visual snapshot is unclear):\n`;
  
  if (step.type === 'CLICK') {
    // PRIORITY 0: Check for dropdown/menu selection FIRST - this is THE MOST IMPORTANT context
    // If decisionSpace exists, this is a dropdown item click, NOT the three-dot button
    if (step.payload.context?.decisionSpace) {
      const ds = step.payload.context.decisionSpace;
      prompt += `\n🎯🎯🎯 CRITICAL: This is a DROPDOWN/MENU ITEM selection! 🎯🎯🎯\n\n`;
      prompt += `The user clicked on a SPECIFIC ITEM within a dropdown menu that was opened by a previous click.\n`;
      prompt += `\nMANDATORY: Your description MUST include the selected item name: "${ds.selectedText}"\n`;
      prompt += `\nDropdown Context:\n`;
      prompt += `  - Selected Item: "${ds.selectedText}" ← THIS IS WHAT WAS CLICKED\n`;
      prompt += `  - Position: Option ${(ds.selectedIndex || 0) + 1} of ${ds.options.length}\n`;
      prompt += `  - Available options: ${ds.options.slice(0, 10).join(', ')}${ds.options.length > 10 ? '...' : ''}\n`;
      prompt += `\n✅ CORRECT format examples:\n`;
      prompt += `   - "Click '${ds.selectedText}' from the options menu"\n`;
      prompt += `   - "Select '${ds.selectedText}' from the menu"\n`;
      prompt += `   - "Click '${ds.selectedText}'"\n`;
      prompt += `\n❌ WRONG format (DO NOT USE):\n`;
      prompt += `   - "Click the three-dot menu button" ← This was the PREVIOUS step, not this one\n`;
      prompt += `   - "Click on element" or "Click on widget" ← Too generic\n`;
      prompt += `   - "Open the options menu" ← This describes opening, not selecting an item\n`;
      prompt += `\nThe visual snapshot should show the dropdown menu with "${ds.selectedText}" visible.\n`;
      prompt += `Use the selectedText "${ds.selectedText}" in your description - this is the actual item clicked.\n`;
      prompt += `\nIMPORTANT: The previous step was clicking the three-dot button to OPEN the menu.\n`;
      prompt += `This step is clicking the ITEM "${ds.selectedText}" WITHIN the opened menu.\n\n`;
    }
    
    // Supplementary context (less important than decisionSpace)
    if (step.payload.label) prompt += `- Label: "${step.payload.label}"\n`;
    if (step.payload.elementText) prompt += `- Element Text: "${step.payload.elementText}"\n`;
    if (step.payload.elementRole) prompt += `- Role: "${step.payload.elementRole}"\n`;
    // Note: Container context is already shown above in PRIMARY section
    if (step.payload.context?.buttonContext?.section) {
      prompt += `- Section: "${step.payload.context.buttonContext.section}"\n`;
    }
    if (step.payload.context?.buttonContext?.label) {
      prompt += `- Button Label: "${step.payload.context.buttonContext.label}"\n`;
    }
    
    prompt += `\nGenerate a SPECIFIC, DISTINCTIVE description (5-15 words, MAX 50 characters):\n`;
    prompt += `\n❌ NEVER return just "CLICK" or "Click" - always include WHAT is being clicked and WHERE (if container context is available).\n`;
    prompt += `✅ GOOD examples: "Click button in How To Guide", "Click three dots in STORE LIST - PORTFOLIO", "Click download icon"\n`;
    prompt += `❌ BAD examples: "CLICK", "Click", "Click element", "Click on widget"\n`;
    
    // If decisionSpace exists, prioritize it heavily
    if (step.payload.context?.decisionSpace) {
      const ds = step.payload.context.decisionSpace;
      const containerText = step.payload.context?.container?.text;
      prompt += `\n🎯 PRIMARY RULE: Since decisionSpace.selectedText="${ds.selectedText}" exists, your description MUST be:\n`;
      if (containerText) {
        prompt += `"Click '${ds.selectedText}' from the options menu in ${containerText}" or "Select '${ds.selectedText}' in ${containerText}"\n`;
      } else {
        prompt += `"Click '${ds.selectedText}' from the options menu" or "Select '${ds.selectedText}'"\n`;
      }
      prompt += `DO NOT describe it as clicking the three-dot button - that was the previous step.\n`;
      prompt += `The current step is clicking the ITEM "${ds.selectedText}" WITHIN the dropdown.\n`;
      prompt += `\nREPEAT: Use "${ds.selectedText}" in your description. This is not optional.\n\n`;
    } else {
      // NO decisionSpace - this is NOT a menu item click
      // This could be clicking on a widget element, button, icon, etc.
      
      // Check if this is a widget element click
      const isWidgetElement = step.payload.selector?.includes('gs-report-widget-element') || 
                              step.payload.selector?.includes('widget-element');
      
      // Detect problematic scenario: widget clicks with generic container text
      // This happens when multiple widgets share the same selector pattern and container text
      // In this case, we need to rely MORE on the visual snapshot to identify the specific widget
      const containerText = step.payload.context?.container?.text;
      const hasGenericContainer = containerText && (
        containerText.length < 20 || // Short generic names like "Demand Gen"
        !/[A-Z]{3,}/.test(containerText) || // No all-caps widget titles
        containerText.toLowerCase().includes('section') ||
        containerText.toLowerCase().includes('dashboard') ||
        containerText.toLowerCase().includes('gen') // Generic section names
      );
      
      const needsSnapshotPriority = isWidgetElement && hasGenericContainer && hasVisualSnapshot;
      
      if (needsSnapshotPriority) {
        // PROBLEMATIC SCENARIO DETECTED: Widget clicks with generic container text
        // Multiple widgets likely share the same selector pattern
        // MUST rely on visual snapshot to identify the specific widget
        prompt += `\n🎯🎯🎯 CRITICAL: WIDGET IDENTIFICATION ISSUE DETECTED 🎯🎯🎯\n\n`;
        prompt += `⚠️ PROBLEM: Multiple widgets share the same selector pattern and generic container text ("${containerText}").\n`;
        prompt += `⚠️ SOLUTION: You MUST rely on the VISUAL SNAPSHOT to identify the SPECIFIC widget that was clicked.\n\n`;
        prompt += `MANDATORY INSTRUCTIONS:\n`;
        prompt += `1. Look at the visual snapshot for the SPECIFIC WIDGET TITLE (e.g., "OFFERS EXPIRING IN NEXT 28 DAYS", "EXPIRED OR REVOKED OFFERS")\n`;
        prompt += `2. The container text "${containerText}" is TOO GENERIC - ignore it and use the widget title from the image instead\n`;
        prompt += `3. If you see a specific widget title in the image, use it in your description\n`;
        prompt += `4. If you see a button/icon being clicked, describe that button/icon WITH the widget title from the image\n`;
        prompt += `5. DO NOT say "Download Data" or "from menu" unless you ACTUALLY see a menu or download button in the image\n`;
        prompt += `6. DO NOT use generic container text "${containerText}" - use the specific widget title from the visual snapshot\n`;
        prompt += `7. If clicking on the widget itself (not a button), say "Click on [widget title from image]" or "Click widget: [widget title from image]"\n`;
        prompt += `8. If clicking a button in the widget, say "Click [button name] in [widget title from image]"\n\n`;
        prompt += `✅ CORRECT examples (based on what you see in the image):\n`;
        prompt += `   - "Click on OFFERS EXPIRING IN NEXT 28 DAYS" (if clicking the widget itself)\n`;
        prompt += `   - "Click three dots in OFFERS EXPIRING IN NEXT 28 DAYS" (if clicking a three-dot button)\n`;
        prompt += `   - "Click widget: EXPIRED OR REVOKED OFFERS" (if clicking the widget)\n\n`;
        prompt += `❌ WRONG examples (DO NOT USE):\n`;
        prompt += `   - "Click 'Download Data' from menu" ← Only use if you ACTUALLY see a menu with "Download Data" in the image\n`;
        prompt += `   - "Click on widget" ← Too generic, use the specific widget title from the image\n`;
        prompt += `   - "Click in ${containerText}" ← Too generic, use the specific widget title from the image instead\n`;
        prompt += `   - Any description that uses "${containerText}" without a specific widget title ← Use widget title from image\n\n`;
      } else {
        // Normal case - include standard instructions
        if (containerText) {
          prompt += `- IMPORTANT: Include the widget/dashboard context "${containerText}" in your description when relevant.\n`;
          prompt += `  Examples: "Click three dots in ${containerText}", "Click download button in ${containerText}"\n`;
        }
        prompt += `- For three-dot menus: "Click the three-dot menu button" or "Open the options menu"\n`;
        prompt += `- For dropdown items: "Click '[item name]' from the [menu name]" (e.g., "Click 'Download' from the export menu")\n`;
        prompt += `- For icons: "Click the [icon name] icon" (e.g., "Click the download icon", "Click the settings icon")\n`;
        prompt += `- For buttons: "Click the [button name] button" (e.g., "Click the download button")\n`;
      }
    }
    
    prompt += `- AVOID generic descriptions like "click on widget" or "click on element" or just "CLICK"\n`;
    prompt += `- ALWAYS include the widget/dashboard name from LOCATION CONTEXT if available (e.g., "Click button in How To Guide")\n`;
    prompt += `- AVOID long concatenated text from containers - use only what you see in the image\n`;
    prompt += `- Make it clear what specific action is being performed\n`;
    prompt += `- Keep descriptions under 50 characters when possible, but prioritize clarity and context over brevity\n`;
    
    prompt += `\n📋 OUTPUT FORMAT: Return your response as JSON with this exact structure:\n`;
    prompt += `{\n`;
    prompt += `  "description": "Your description here (MUST include container context if available)",\n`;
    prompt += `  "confidence": 0.9\n`;
    prompt += `}\n`;
    prompt += `\nCRITICAL: The description field MUST NOT be just "CLICK" or "Click". It MUST include WHAT is being clicked and WHERE (if container context is available).\n`;
  } else if (step.type === 'INPUT') {
    if (step.payload.label) prompt += `- Field Label: "${step.payload.label}"\n`;
    if (step.payload.value) prompt += `- Value Entered: "${step.payload.value.substring(0, 100)}"\n`;
    if (step.payload.context?.formCoordinates?.label) {
      prompt += `- Form Field: "${step.payload.context.formCoordinates.label}"\n`;
    }
    
    if (hasVisualSnapshot) {
      prompt += `\n🎯 Use the visual snapshot to identify the field type and label. Generate: "Enter [value] in [field name]" or "Type [value] into the [field] field"\n`;
    } else {
      prompt += `\nGenerate a description like: "Enter [value] in [field name]" or "Type [value] into the [field] field"\n`;
    }
  } else if (step.type === 'NAVIGATION') {
    if (step.payload.url) prompt += `- URL: ${step.payload.url}\n`;
    prompt += `\nGenerate a description like: "Navigate to [page name]" or "Go to [page/URL]"\n`;
  } else if (step.type === 'KEYBOARD') {
    const keyboardDetails = step.payload.keyboardDetails;
    const isCopy = keyboardDetails?.key?.toLowerCase() === 'c' && 
                   (keyboardDetails.modifiers?.ctrl || keyboardDetails.modifiers?.meta);
    const isPaste = keyboardDetails?.key?.toLowerCase() === 'v' && 
                    (keyboardDetails.modifiers?.ctrl || keyboardDetails.modifiers?.meta);
    
    if (isCopy) {
      const clipboardData = step.payload.aiEvidence?.clipboardMetadata;
      if (clipboardData?.copiedValue) {
        prompt += `\n🎯 COPY OPERATION DETECTED\n\n`;
        prompt += `The user pressed Ctrl+C (or Cmd+C on Mac) to copy data.\n`;
        prompt += `- Copied Value: "${clipboardData.copiedValue.substring(0, 200)}${clipboardData.copiedValue.length > 200 ? '...' : ''}"\n`;
        prompt += `- Source Location: ${clipboardData.sourceSelector}\n\n`;
        prompt += `Your task: Generate a description that explains WHAT was copied and its semantic meaning.\n`;
        prompt += `Examples:\n`;
        prompt += `- If it's an email: "Copy email address from contact field"\n`;
        prompt += `- If it's a name: "Copy contact name"\n`;
        prompt += `- If it's a phone number: "Copy phone number"\n`;
        prompt += `- If it's text: "Copy text: [first 20 chars]"\n`;
        prompt += `\nAnalyze the copied value and provide semantic reasoning about what type of data it is.\n`;
      } else {
        prompt += `- Key: Copy (Ctrl+C/Cmd+C)\n`;
        prompt += `- Action: User copied selected text\n`;
      }
    } else if (isPaste) {
      const clipboardData = step.payload.aiEvidence?.clipboardMetadata;
      if (clipboardData?.copiedValue) {
        prompt += `\n🎯 PASTE OPERATION DETECTED\n\n`;
        prompt += `The user pressed Ctrl+V (or Cmd+V on Mac) to paste previously copied data.\n`;
        prompt += `- Pasted Value: "${clipboardData.copiedValue.substring(0, 200)}${clipboardData.copiedValue.length > 200 ? '...' : ''}"\n`;
        prompt += `- Original Source: ${clipboardData.sourceSelector}\n`;
        if (step.payload.label) {
          prompt += `- Target Field: "${step.payload.label}"\n`;
        }
        prompt += `\nYour task: Generate a description that explains WHAT was pasted and WHERE.\n`;
        prompt += `Examples:\n`;
        prompt += `- "Paste email address into contact form"\n`;
        prompt += `- "Paste copied name into name field"\n`;
        prompt += `- "Paste phone number into phone field"\n`;
        prompt += `\nInclude both the semantic meaning of the data AND the target location.\n`;
      } else {
        prompt += `- Key: Paste (Ctrl+V/Cmd+V)\n`;
        prompt += `- Action: User pasted clipboard content\n`;
      }
    } else {
      // Existing handling for other keys (Enter, Tab, Escape)
      if (step.payload.keyboardDetails?.key) {
        prompt += `- Key: ${step.payload.keyboardDetails.key}\n`;
      }
      
      if (hasVisualSnapshot) {
        prompt += `\n🎯 Use the visual snapshot to understand the context. Generate: "Press [key]" or "Press [key] to [action]"\n`;
      } else {
        prompt += `\nGenerate a description like: "Press [key]" or "Press [key] to [action]"\n`;
      }
    }
  } else if (step.type === 'SCROLL') {
    if (step.payload.viewport) {
      const scrollX = step.payload.viewport.scrollX || 0;
      const scrollY = step.payload.viewport.scrollY || 0;
      if (scrollY > 0) {
        prompt += `- Scrolled down to Y position: ${Math.round(scrollY)}px\n`;
      } else if (scrollX > 0) {
        prompt += `- Scrolled right to X position: ${Math.round(scrollX)}px\n`;
      }
    }
    
    if (hasVisualSnapshot) {
      prompt += `\n🎯 Use the visual snapshot to see what content is visible after scrolling. Generate: "Scroll to [visible content]" or "Scroll down/up to [element]"\n`;
      prompt += `Example: "Scroll down to the 'Submit' button" or "Scroll to the form section"\n`;
    } else {
      prompt += `\nGenerate a description like: "Scroll to [location]" or "Scroll down/up"\n`;
    }
  }
  
  prompt += `\nReturn JSON with this exact structure:\n`;
  prompt += `{\n`;
  prompt += `  "description": "clear, concise description in 5-15 words",\n`;
  prompt += `  "confidence": 0.0-1.0\n`;
  prompt += `}\n\n`;
  prompt += `Only return valid JSON, no markdown formatting.`;

  return prompt;
}

/**
 * Parse Gemini API response
 */
function parseGeminiResponse(geminiData: any, payload: StepDescriptionPayload): StepDescriptionResult {
  try {
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Try to extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Gemini response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    let description = typeof parsed.description === 'string' ? parsed.description.trim() : 'Action performed';
    
    // VALIDATION: Reject generic "CLICK" responses and generate better fallback
    const genericPatterns = /^(CLICK|Click|click|Click element|Click on element|Click on widget)$/i;
    if (genericPatterns.test(description) && payload.step.type === 'CLICK') {
      console.warn('⚠️ AI returned generic "CLICK" description, generating fallback with context');
      
      // Generate better description using available context
      const containerText = payload.step.payload.context?.container?.text;
      const elementText = payload.step.payload.elementText;
      const label = payload.step.payload.label;
      const selectedText = payload.step.payload.context?.decisionSpace?.selectedText;
      
      if (selectedText) {
        description = containerText 
          ? `Click '${selectedText}' in ${containerText}`
          : `Click '${selectedText}'`;
      } else if (elementText && elementText.length <= 30) {
        description = containerText
          ? `Click "${elementText}" in ${containerText}`
          : `Click "${elementText}"`;
      } else if (label && label.length <= 30) {
        description = containerText
          ? `Click "${label}" in ${containerText}`
          : `Click "${label}"`;
      } else if (containerText && containerText.length <= 40) {
        description = `Click in "${containerText}"`;
      } else {
        description = 'Click element';
      }
      
      console.log('✅ Generated fallback description:', description);
    }
    
    // ADDITIONAL VALIDATION: Check if description matches recorded element data
    // This prevents AI from hallucinating completely wrong descriptions
    const parentText = payload.step.payload.context?.parent?.text;
    const ariaLabel = payload.step.payload.aiEvidence?.semanticAnchors?.ariaLabel;
    const textLabel = payload.step.payload.aiEvidence?.semanticAnchors?.textLabel;
    
    // Get the most reliable recorded text
    const recordedText = ariaLabel || textLabel || parentText;
    
    if (recordedText && payload.step.type === 'CLICK') {
      const descLower = description.toLowerCase();
      const recordedLower = recordedText.toLowerCase();
      
      // Check if description contains at least the first 10 chars of recorded text
      const recordedSubstring = recordedLower.substring(0, Math.min(10, recordedLower.length));
      
      if (!descLower.includes(recordedSubstring) && recordedText.length >= 3) {
        console.warn(`⚠️ Description "${description}" doesn't match recorded element "${recordedText}"`);
        console.warn(`⚠️ Using recorded text instead`);
        
        // Use recorded text directly with proper formatting
        const containerText = payload.step.payload.context?.container?.text;
        description = containerText && containerText.length <= 40
          ? `Click "${recordedText}" in ${containerText}`
          : `Click on "${recordedText}"`;
        
        console.log('✅ Corrected description:', description);
      }
    }
    
    const result: StepDescriptionResult = {
      description,
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    };

    return result;
  } catch (error) {
    console.error('Error parsing Gemini response:', error);
    // Return fallback result with context
    const containerText = payload.step.payload.context?.container?.text;
    const elementText = payload.step.payload.elementText;
    let fallbackDescription = 'Action performed';
    
    if (payload.step.type === 'CLICK' && containerText) {
      fallbackDescription = elementText && elementText.length <= 30
        ? `Click "${elementText}" in ${containerText}`
        : `Click in "${containerText}"`;
    }
    
    return {
      description: fallbackDescription,
      confidence: 0,
    };
  }
}


