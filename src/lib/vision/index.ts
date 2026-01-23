/**
 * Vision Execution System
 *
 * A human-like automation system that:
 * - SEES the screen (Eyes)
 * - THINKS about what to do (Brain)
 * - ACTS precisely (Hands via CDP)
 *
 * This is the main entry point for the vision system.
 */

// Eyes - Vision capabilities
export * from './eyes';

// Brain - Reasoning capabilities
export * from './brain';

// Hands - Action capabilities (CDP-based)
export * from './hands';

// Agent - Integrated vision agent
export * from './agent';

// Types
export * from './types';
