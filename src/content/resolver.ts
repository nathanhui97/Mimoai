/**
 * Resolver - Decision-making for element resolution
 * 
 * Separated from CandidateFinder for cleaner architecture.
 * This module:
 * 1. Scores candidates at runtime using features + current DOM
 * 2. Ranks candidates and decides: found / ambiguous / not_found
 * 3. Applies disambiguation using nearby text
 */

import type { LocatorBundle, LocatorType, LocatorFeatures } from '../types/locator';
import type { Intent } from '../types/intent';
import { resolveScopeContainer } from '../types/scope';
import { CandidateFinder } from './candidate-finder';
import type { CandidateResult } from './candidate-finder';
import { MenuDetector } from './menu-detector';

/**
 * Metrics collected during resolution
 */
export interface ResolveMetrics {
  /** Number of strategies attempted */
  strategiesAttempted: number;
  /** Candidates found per strategy type */
  candidatesPerStrategy: Record<string, number>;
  /** Whether disambiguation was applied */
  disambiguationApplied: boolean;
  /** Total time taken in ms */
  totalTimeMs: number;
  /** Which strategy won (if found) */
  winningStrategy?: string;
  /** Whether result was ambiguous before disambiguation */
  wasAmbiguous: boolean;
}

/**
 * Result of resolution attempt
 */
export type ResolveResult =
  | { status: 'found'; element: Element; winningStrategy: string; metrics: ResolveMetrics }
  | { status: 'ambiguous'; candidates: CandidateResult[]; metrics: ResolveMetrics }
  | { status: 'not_found'; triedStrategies: string[]; metrics: ResolveMetrics };

/**
 * Scored candidate for internal ranking
 */
interface ScoredCandidate {
  candidate: CandidateResult;
  runtimeScore: number;
  featureScore: number;
  totalScore: number;
}

/**
 * Resolver handles decision-making for element resolution
 */
export class Resolver {
  /**
   * Main resolution: find best candidate or report status
   */
  static async resolve(
    bundle: LocatorBundle,
    intent: Intent,
    doc: Document = document
  ): Promise<ResolveResult> {
    const startTime = Date.now();
    
    // 🎯 CRITICAL: For menu items, skip scope and search document-wide
    // Menu items are often in portals/overlays outside the widget DOM tree
    const roleStrategy = bundle.strategies.find(s => s.type === 'role');
    const rolePart = roleStrategy?.value?.split(':')[0]; // Extract role part (e.g., "menuitem" from "menuitem:Download Data")
    const isMenuItem = rolePart === 'menuitem' || rolePart === 'option';
    
    // Find scope container
    // CRITICAL: If scope resolution fails, fall back to document-wide search
    // We'll use scope for disambiguation later if multiple candidates are found
    // SKIP scope for menu items - they're in portals/overlays
    let scopeContainer = (!isMenuItem && bundle.scope)
      ? resolveScopeContainer(bundle.scope, doc)
      : doc.body;
    
    if (!scopeContainer || (isMenuItem && bundle.scope)) {
      if (isMenuItem) {
        console.log(`[Resolver] 🎯 Menu item detected - skipping scope, searching document-wide (menus are in portals)`);
      } else {
        const scopeDesc = bundle.scope?.kind === 'WIDGET' 
          ? `${bundle.scope.kind}:${bundle.scope.title}`
          : bundle.scope?.kind || 'unknown';
        console.warn(`[Resolver] ⚠️ Scope "${scopeDesc}" not found, falling back to document-wide search`);
      }
      scopeContainer = doc.body; // Fall back to full document search
      // DON'T abort - continue with document-wide search and use scope for disambiguation later
    }
    
    // Find all candidates
    const candidatesMap = await CandidateFinder.findCandidates(bundle, doc);
    
    // Build metrics
    const candidatesPerStrategy: Record<string, number> = {};
    let totalCandidates = 0;
    
    for (const [strategyType, candidates] of candidatesMap.entries()) {
      candidatesPerStrategy[strategyType] = candidates.length;
      totalCandidates += candidates.length;
    }
    
    // No candidates found
    if (totalCandidates === 0) {
      return {
        status: 'not_found',
        triedStrategies: bundle.strategies.map(s => s.type),
        metrics: this.createMetrics(
          bundle.strategies.length, 
          candidatesPerStrategy, 
          false, 
          startTime,
          false
        ),
      };
    }
    
    // Collect all candidates and score them
    const allCandidates: CandidateResult[] = [];
    for (const candidates of candidatesMap.values()) {
      allCandidates.push(...candidates);
    }
    
    // CRITICAL: If looking for menu items, filter to ONLY items in the currently visible menu
    // This prevents finding "Download Data" from OTHER widgets' menus
    let filteredCandidates = allCandidates;
    if (bundle.role === 'menuitem' || bundle.role === 'option') {
      const visibleMenu = MenuDetector.findVisibleMenu();
      
      if (visibleMenu) {
        const menuItems = MenuDetector.extractMenuItems(visibleMenu);
        console.log(`[Resolver] 🎯 Filtering ${allCandidates.length} candidates to only those in the visible menu (${menuItems.length} items)`);
        
        filteredCandidates = allCandidates.filter(candidate => 
          menuItems.includes(candidate.element)
        );
        
        console.log(`[Resolver] ✅ Filtered to ${filteredCandidates.length} candidates in visible menu`);
      } else {
        console.warn(`[Resolver] ⚠️ No visible menu found - can't filter menu item candidates`);
      }
    }
    
    // Deduplicate by element
    const uniqueCandidates = this.deduplicateCandidates(filteredCandidates);
    
    // Score all candidates
    const scoredCandidates = uniqueCandidates.map(candidate => 
      this.scoreCandidate(candidate, bundle, intent, doc)
    );
    
    // Sort by total score descending
    scoredCandidates.sort((a, b) => b.totalScore - a.totalScore);
    
    // Check if we have a clear winner
    const wasAmbiguous = scoredCandidates.length > 1 && 
      (scoredCandidates[0].totalScore - scoredCandidates[1].totalScore) < 0.2;
    
    // Apply disambiguation if ambiguous
    let disambiguationApplied = false;
    if (wasAmbiguous && bundle.disambiguators.length > 0) {
      disambiguationApplied = true;
      const filtered = CandidateFinder.filterByDisambiguators(
        scoredCandidates.map(s => s.candidate),
        bundle.disambiguators
      );
      
      if (filtered.length === 1) {
        const winningStrategy = filtered[0].strategy.type;
        return {
          status: 'found',
          element: filtered[0].element,
          winningStrategy,
          metrics: this.createMetrics(
            bundle.strategies.length,
            candidatesPerStrategy,
            disambiguationApplied,
            startTime,
            wasAmbiguous,
            winningStrategy
          ),
        };
      }
    }
    
    // If still ambiguous after disambiguation, return ambiguous
    if (wasAmbiguous) {
      return {
        status: 'ambiguous',
        candidates: scoredCandidates.slice(0, 5).map(s => s.candidate),
        metrics: this.createMetrics(
          bundle.strategies.length,
          candidatesPerStrategy,
          disambiguationApplied,
          startTime,
          wasAmbiguous
        ),
      };
    }
    
    // We have a clear winner
    const winner = scoredCandidates[0];
    return {
      status: 'found',
      element: winner.candidate.element,
      winningStrategy: winner.candidate.strategy.type,
      metrics: this.createMetrics(
        bundle.strategies.length,
        candidatesPerStrategy,
        disambiguationApplied,
        startTime,
        wasAmbiguous,
        winner.candidate.strategy.type
      ),
    };
  }
  
  /**
   * Score a candidate at runtime using features + current DOM context
   */
  static scoreCandidate(
    candidate: CandidateResult,
    bundle: LocatorBundle,
    intent: Intent,
    doc: Document
  ): ScoredCandidate {
    const features = candidate.strategy.features;
    const matchScore = candidate.matchScore || 0.5;
    
    // Feature-based score (from recorded features)
    const featureScore = this.computeFeatureScore(features, candidate.strategy.type);
    
    // Runtime score (from current DOM state)
    const runtimeScore = this.computeRuntimeScore(candidate, bundle, intent, doc);
    
    // Combined score (weighted average)
    const totalScore = (featureScore * 0.4) + (runtimeScore * 0.3) + (matchScore * 0.3);
    
    return {
      candidate,
      runtimeScore,
      featureScore,
      totalScore,
    };
  }
  
  /**
   * Compute score based on recorded features
   */
  private static computeFeatureScore(features: LocatorFeatures, strategyType: LocatorType): number {
    let score = 0.5; // Base score
    
    // Bonus for stable attributes
    if (features.hasStableAttributes) {
      score += 0.2;
    }
    
    // Bonus for unique match at record time
    if (features.uniqueMatchAtRecordTime) {
      score += 0.15;
    }
    
    // Penalty for dynamic parts
    if (features.hasDynamicParts) {
      score -= 0.2;
    }
    
    // Penalty for likely dynamic text
    if (features.textStabilityHint === 'likely_dynamic') {
      score -= 0.15;
    } else if (features.textStabilityHint === 'stable') {
      score += 0.1;
    }
    
    // Strategy type bonuses
    const strategyBonus: Record<LocatorType, number> = {
      'testid': 0.15,
      'aria': 0.12,
      'role': 0.1,
      'css': 0.05,
      'text': 0.0,
      'xpath': -0.05,
      'position': -0.2,
      'visual': -0.1,
    };
    score += strategyBonus[strategyType] || 0;
    
    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, score));
  }
  
  /**
   * Compute score based on current DOM state
   */
  private static computeRuntimeScore(
    candidate: CandidateResult,
    _bundle: LocatorBundle,
    intent: Intent,
    doc: Document
  ): number {
    let score = 0.5;
    const element = candidate.element;
    const features = candidate.strategy.features;
    
    // Check if tag name matches
    if (element.tagName.toLowerCase() === features.recordedTagName.toLowerCase()) {
      score += 0.1;
    } else {
      score -= 0.1;
    }
    
    // Check if role matches
    const currentRole = element.getAttribute('role');
    if (features.recordedRole) {
      if (currentRole === features.recordedRole) {
        score += 0.1;
      } else {
        score -= 0.1;
      }
    }
    
    // Check current uniqueness
    try {
      const currentMatches = doc.querySelectorAll(candidate.strategy.value);
      if (currentMatches.length === 1) {
        score += 0.15;
      } else if (currentMatches.length > 5) {
        score -= 0.1;
      }
    } catch (e) {
      // Invalid selector
    }
    
    // Intent-specific scoring
    score += this.scoreForIntent(element, intent);
    
    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, score));
  }
  
  /**
   * Score based on intent-specific requirements
   */
  private static scoreForIntent(element: Element, intent: Intent): number {
    let score = 0;
    
    switch (intent.kind) {
      case 'CLICK':
      case 'OPEN_ROW_ACTIONS':
        // Should be clickable
        if (this.isClickable(element)) score += 0.1;
        break;
        
      case 'TYPE':
        // Should be an input
        if (element instanceof HTMLInputElement || 
            element instanceof HTMLTextAreaElement ||
            element.getAttribute('contenteditable') === 'true') {
          score += 0.1;
        }
        break;
        
      case 'SELECT_DROPDOWN_OPTION':
        // Should be a listbox option
        const role = element.getAttribute('role');
        if (role === 'option' || role === 'menuitem') {
          score += 0.1;
        }
        break;
        
      case 'TOGGLE_CHECKBOX':
        // Should be a checkbox
        if (element instanceof HTMLInputElement && element.type === 'checkbox') {
          score += 0.15;
        }
        break;
        
      case 'SUBMIT_FORM':
        // Should be a submit button or form
        if (element instanceof HTMLButtonElement && element.type === 'submit') {
          score += 0.1;
        }
        break;
    }
    
    return score;
  }
  
  /**
   * Check if element is clickable
   */
  private static isClickable(element: Element): boolean {
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'button' || tagName === 'a') return true;
    
    const role = element.getAttribute('role');
    if (role === 'button' || role === 'link' || role === 'menuitem') return true;
    
    if (element.getAttribute('onclick')) return true;
    if (element.getAttribute('tabindex')) return true;
    
    return false;
  }
  
  /**
   * Deduplicate candidates by element reference
   */
  private static deduplicateCandidates(candidates: CandidateResult[]): CandidateResult[] {
    const seen = new Set<Element>();
    const unique: CandidateResult[] = [];
    
    for (const candidate of candidates) {
      if (!seen.has(candidate.element)) {
        seen.add(candidate.element);
        unique.push(candidate);
      }
    }
    
    return unique;
  }
  
  /**
   * Create metrics object
   */
  private static createMetrics(
    strategiesAttempted: number,
    candidatesPerStrategy: Record<string, number>,
    disambiguationApplied: boolean,
    startTime: number,
    wasAmbiguous: boolean,
    winningStrategy?: string
  ): ResolveMetrics {
    return {
      strategiesAttempted,
      candidatesPerStrategy,
      disambiguationApplied,
      totalTimeMs: Date.now() - startTime,
      winningStrategy,
      wasAmbiguous,
    };
  }
  
  /**
   * Filter candidates by nearby text (disambiguation)
   * Re-exported from CandidateFinder for convenience
   */
  static disambiguate(
    candidates: CandidateResult[],
    disambiguators: string[]
  ): CandidateResult[] {
    return CandidateFinder.filterByDisambiguators(candidates, disambiguators);
  }
}

