/**
 * Variable Extractor (Phase 2)
 *
 * Extracts variable values from natural language queries with context awareness.
 * Combines:
 * - Pattern-based extraction (instant)
 * - Conversation context resolution
 * - AI-powered extraction (when needed)
 */

import type { SavedWorkflow } from '../types/workflow';
import { aiConfig } from './ai-config';

// ============================================================================
// Types
// ============================================================================

export interface VariableDefinition {
  variableName: string;
  fieldName: string;
  defaultValue: string;
  inputType?: string;
  options?: string[];
}

export interface ExtractionResult {
  values: Record<string, string>;
  confidence: Record<string, number>;
  needsClarification: string[];
  reasoning?: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

// ============================================================================
// Pattern Extractors
// ============================================================================

// Common patterns for extracting values
const EXTRACTION_PATTERNS = {
  // Money amounts: $50k, $1.5M, fifty thousand, etc.
  money: [
    /\$[\d,]+(?:\.\d{2})?(?:k|K|m|M|b|B)?/g,
    /[\d,]+(?:\.\d{2})?\s*(?:dollars?|USD|usd)/gi,
    /(?:worth|value|amount|price|cost)(?:\s+(?:of|is|:))?\s*\$?[\d,]+(?:\.\d{2})?(?:k|K|m|M)?/gi,
  ],

  // Company/Organization names (capitalized words)
  company: [
    /(?:for|from|with|at|company|client|customer|organization|org)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*(?:\s+(?:Inc|LLC|Corp|Ltd|Co|Company|Industries|Technologies)\.?)?)/g,
  ],

  // Person names
  person: [
    /(?:for|from|with|contact|person|name)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g,
  ],

  // Email addresses
  email: [
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  ],

  // Phone numbers
  phone: [
    /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g,
  ],

  // Dates
  date: [
    /\d{1,2}\/\d{1,2}\/\d{2,4}/g,
    /\d{4}-\d{2}-\d{2}/g,
    /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,?\s+\d{4})?/gi,
  ],

  // Numbers
  number: [
    /\b\d+(?:\.\d+)?\b/g,
  ],
};

// ============================================================================
// Variable Extractor Class
// ============================================================================

export class VariableExtractor {
  /**
   * Extract variables with conversation context
   */
  static async extractWithContext(
    query: string,
    variables: VariableDefinition[],
    conversationHistory: ConversationMessage[] = [],
    workflow?: SavedWorkflow
  ): Promise<ExtractionResult> {
    // 1. Try pattern-based extraction first (instant)
    const patternExtracted = this.extractFromPatterns(query, variables, workflow?.learnedSkill?.extractableVariables);

    // 2. If incomplete, try conversation context
    const contextExtracted = this.extractFromConversation(
      variables.filter(v => !patternExtracted.values[v.variableName]),
      conversationHistory
    );

    // Merge pattern and context extractions
    const mergedValues = { ...patternExtracted.values, ...contextExtracted };
    const mergedConfidence = { ...patternExtracted.confidence };
    for (const [key, value] of Object.entries(contextExtracted)) {
      if (value) {
        mergedConfidence[key] = 0.7; // Lower confidence for context-based
      }
    }

    // 3. If still incomplete, call AI extraction
    const remaining = variables.filter(v => !mergedValues[v.variableName]);

    if (remaining.length > 0) {
      const aiResult = await this.extractWithAI(query, remaining, conversationHistory, workflow);

      return {
        values: { ...mergedValues, ...aiResult.values },
        confidence: { ...mergedConfidence, ...aiResult.confidence },
        needsClarification: aiResult.needsClarification,
        reasoning: aiResult.reasoning,
      };
    }

    return {
      values: mergedValues,
      confidence: mergedConfidence,
      needsClarification: [],
    };
  }

  /**
   * Extract from patterns (instant, no API call)
   */
  static extractFromPatterns(
    query: string,
    variables: VariableDefinition[],
    learnedPatterns?: any[]
  ): { values: Record<string, string>; confidence: Record<string, number> } {
    const values: Record<string, string> = {};
    const confidence: Record<string, number> = {};

    for (const variable of variables) {
      // Try to infer the pattern type from variable metadata
      const patternType = this.inferPatternType(variable);

      if (patternType && EXTRACTION_PATTERNS[patternType as keyof typeof EXTRACTION_PATTERNS]) {
        for (const pattern of EXTRACTION_PATTERNS[patternType as keyof typeof EXTRACTION_PATTERNS]) {
          const matches = query.match(pattern);
          if (matches && matches.length > 0) {
            // Use the first match (or captured group if available)
            const match = matches[0];
            const cleanedValue = this.cleanExtractedValue(match, patternType);

            if (cleanedValue) {
              values[variable.variableName] = cleanedValue;
              confidence[variable.variableName] = 0.85;
              break;
            }
          }
        }
      }

      // Try learned patterns if available
      if (!values[variable.variableName] && learnedPatterns) {
        const learnedPattern = learnedPatterns.find(p => p.variableName === variable.variableName);
        if (learnedPattern?.extractionPattern) {
          try {
            const regex = new RegExp(learnedPattern.extractionPattern, 'gi');
            const match = query.match(regex);
            if (match && match[0]) {
              values[variable.variableName] = match[0];
              confidence[variable.variableName] = 0.75;
            }
          } catch (e) {
            // Invalid regex, skip
          }
        }
      }
    }

    return { values, confidence };
  }

  /**
   * Extract from conversation history
   */
  static extractFromConversation(
    variables: VariableDefinition[],
    history: ConversationMessage[]
  ): Record<string, string> {
    const extracted: Record<string, string> = {};

    if (history.length === 0) {
      return extracted;
    }

    // Get recent messages (last 5)
    const recentMessages = history.slice(-5);

    // Extract entities from recent messages
    const entities = this.extractEntitiesFromMessages(recentMessages);

    for (const variable of variables) {
      // Try to match entity type to variable type
      const matchingEntity = entities.find(e =>
        this.entityTypeMatches(e.type, variable.inputType || 'text')
      );

      if (matchingEntity) {
        extracted[variable.variableName] = matchingEntity.value;
      }
    }

    return extracted;
  }

  /**
   * Extract with AI (when pattern/context fails)
   */
  static async extractWithAI(
    query: string,
    variables: VariableDefinition[],
    conversationHistory: ConversationMessage[] = [],
    workflow?: SavedWorkflow
  ): Promise<ExtractionResult> {
    try {
      const config = aiConfig.getConfig();
      const url = `${config.supabaseUrl}/functions/v1/extract_variables`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify({
          userQuery: query,
          variables: variables.map(v => ({
            variableName: v.variableName,
            fieldName: v.fieldName,
            defaultValue: v.defaultValue,
            inputType: v.inputType,
            options: v.options,
          })),
          conversationContext: conversationHistory
            .slice(-5)
            .map(m => `${m.role}: ${m.content}`),
          workflowName: workflow?.name,
          workflowDescription: workflow?.description,
        }),
      });

      if (!response.ok) {
        console.warn('[VariableExtractor] AI extraction failed:', response.status);
        return { values: {}, confidence: {}, needsClarification: [] };
      }

      const result = await response.json();

      return {
        values: result.extracted || {},
        confidence: result.confidence || {},
        needsClarification: result.ambiguous || [],
        reasoning: result.reasoning,
      };
    } catch (error) {
      console.error('[VariableExtractor] AI extraction error:', error);
      return { values: {}, confidence: {}, needsClarification: [] };
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Infer pattern type from variable metadata
   */
  private static inferPatternType(variable: VariableDefinition): string | null {
    const name = variable.variableName.toLowerCase();
    const type = variable.inputType?.toLowerCase() || '';

    // Money/amount
    if (name.includes('amount') || name.includes('price') || name.includes('cost') ||
        name.includes('value') || name.includes('budget') || type === 'currency') {
      return 'money';
    }

    // Company
    if (name.includes('company') || name.includes('organization') || name.includes('org') ||
        name.includes('client') || name.includes('customer') || name.includes('account')) {
      return 'company';
    }

    // Person
    if (name.includes('name') || name.includes('person') || name.includes('contact')) {
      return 'person';
    }

    // Email
    if (name.includes('email') || type === 'email') {
      return 'email';
    }

    // Phone
    if (name.includes('phone') || name.includes('tel') || type === 'tel') {
      return 'phone';
    }

    // Date
    if (name.includes('date') || type === 'date') {
      return 'date';
    }

    // Number
    if (type === 'number' || name.includes('count') || name.includes('quantity')) {
      return 'number';
    }

    return null;
  }

  /**
   * Clean extracted value based on type
   */
  private static cleanExtractedValue(value: string, type: string): string {
    switch (type) {
      case 'money':
        // Normalize money values
        let amount = value.replace(/[,$]/g, '');

        // Handle k/M/B suffixes
        if (/k$/i.test(amount)) {
          amount = String(parseFloat(amount.slice(0, -1)) * 1000);
        } else if (/m$/i.test(amount)) {
          amount = String(parseFloat(amount.slice(0, -1)) * 1000000);
        } else if (/b$/i.test(amount)) {
          amount = String(parseFloat(amount.slice(0, -1)) * 1000000000);
        }

        return amount;

      case 'company':
        // Remove common prefixes
        return value
          .replace(/^(?:for|from|with|at|company|client|customer|organization|org)\s+/i, '')
          .trim();

      case 'person':
        // Remove common prefixes
        return value
          .replace(/^(?:for|from|with|contact|person|name)\s+/i, '')
          .trim();

      default:
        return value.trim();
    }
  }

  /**
   * Extract entities from conversation messages
   */
  private static extractEntitiesFromMessages(messages: ConversationMessage[]): Array<{ type: string; value: string }> {
    const entities: Array<{ type: string; value: string }> = [];

    for (const message of messages) {
      const text = message.content;

      // Extract company names
      const companyMatches = text.match(/(?:for|from|with|at)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/g);
      if (companyMatches) {
        for (const match of companyMatches) {
          const company = match.replace(/^(?:for|from|with|at)\s+/i, '').trim();
          entities.push({ type: 'company', value: company });
        }
      }

      // Extract money amounts
      const moneyMatches = text.match(/\$[\d,]+(?:\.\d{2})?(?:k|K|m|M)?/g);
      if (moneyMatches) {
        for (const match of moneyMatches) {
          entities.push({ type: 'money', value: match });
        }
      }

      // Extract email addresses
      const emailMatches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
      if (emailMatches) {
        for (const match of emailMatches) {
          entities.push({ type: 'email', value: match });
        }
      }
    }

    return entities;
  }

  /**
   * Check if entity type matches variable input type
   */
  private static entityTypeMatches(entityType: string, inputType: string): boolean {
    const inputTypeLower = inputType.toLowerCase();

    switch (entityType) {
      case 'company':
        return inputTypeLower.includes('company') || inputTypeLower.includes('org') ||
               inputTypeLower.includes('account') || inputTypeLower === 'text';
      case 'money':
        return inputTypeLower.includes('amount') || inputTypeLower.includes('currency') ||
               inputTypeLower.includes('price') || inputTypeLower === 'number';
      case 'email':
        return inputTypeLower === 'email';
      case 'phone':
        return inputTypeLower === 'tel' || inputTypeLower === 'phone';
      default:
        return false;
    }
  }
}

export const variableExtractor = VariableExtractor;
