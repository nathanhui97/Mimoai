/**
 * Eyes Module
 *
 * The vision capabilities of the agent:
 * - Screenshot capture
 * - Screen analysis via AI
 * - Element location by visual description
 */

// Screenshot capture
export {
  captureScreenshot,
  captureViewport,
  captureScreenshotCDP,
  extractBase64,
  compressScreenshot,
} from './screenshot';

// Screen analysis
export {
  analyzeScreen,
  describeScreen,
  detectPageType,
  hasPageChanged,
  initVisionConfig,
  createBasicScreenUnderstanding,
} from './analyzer';

// Element finding
export {
  findElement,
  findAllElements,
  findFormField,
  findButton,
  findLink,
  findCheckbox,
  findDropdown,
  findDropdownOption,
  findDatePicker,
  findCalendarDate,
  getClickCoordinates,
  getBoundingBoxCenter,
  initElementFinderConfig,
} from './element-finder';
