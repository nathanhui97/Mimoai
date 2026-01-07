/**
 * Recording Module - Public API
 * 
 * This module provides all recording functionality for the extension.
 * Import from this file to access recording components.
 */

// Types
export * from './types';

// Core components
export { ElementFinder, elementFinder } from './element-finder';
export { StepPublisher, type StepPublisherContext } from './step-publisher';
export { StepEnricher, type StepEnricherConfig } from './step-enricher';

