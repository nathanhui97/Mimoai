# CRM Testing Template

## Overview

This document provides a standardized testing workflow for validating the Mimoai extension on CRM platforms. Use this template to systematically test recording, variable detection, and replay functionality.

## Prerequisites

- ✅ Extension loaded and enabled in Chrome
- ✅ CRM account with appropriate permissions
- ✅ Test data prepared (names, emails, phone numbers, companies)
- ✅ Extension version checked (latest build)

## Standard CRM Test Workflow

### Phase 1: Record - Create New Contact/Lead

**Test Name**: `{CRM_NAME}_new_lead_creation`

**Steps**:

1. **Navigate to CRM**
   - Open CRM login page
   - Login with credentials
   - Wait for dashboard to fully load

2. **Open New Contact/Lead Form**
   - Navigate to Contacts/Leads list
   - Click "New Contact" or "New Lead" button
   - Wait for form to appear/load

3. **Fill Required Fields**
   - First Name: `Test`
   - Last Name: `User`
   - Email: `test@example.com`
   - Phone: `(555) 123-4567`
   - Company: `Test Company`

4. **Fill Optional Fields** (platform-specific)
   - Title/Job Title
   - Lead Source
   - Status/Stage
   - Industry
   - Website
   - Address fields

5. **Select Dropdowns** (if applicable)
   - Lead Status: `New` or `Qualified`
   - Lead Source: `Web` or `Referral`
   - Industry: `Technology` or relevant option

6. **Save**
   - Click "Save" or "Create" button
   - Wait for success message/redirect
   - Verify record was created

7. **Stop Recording**
   - Click "Stop Recording" in extension
   - Verify all steps captured

**Expected Captured Steps**:
- ~15-25 steps (including navigation, inputs, dropdowns, save)
- All text inputs should have labels
- Dropdowns should have options captured
- Success indicators recorded

---

### Phase 2: Analyze - Variable Detection

**Manual Review Checklist**:

1. **Open Workflow in Extension**
   - Click on saved workflow
   - Review captured steps

2. **Verify Variables Detected**
   - [ ] First Name detected as variable
   - [ ] Last Name detected as variable  
   - [ ] Email detected as variable
   - [ ] Phone detected as variable
   - [ ] Company detected as variable
   - [ ] Dropdown selections detected as choice elements

3. **Check Variable Quality**
   - [ ] Variables have clear labels (not "Input Field 1")
   - [ ] Input types are correct (email = email, phone = tel)
   - [ ] Dropdown options are complete
   - [ ] No duplicate variables

4. **Review Optimized Steps**
   - [ ] Workflow optimization reduced step count
   - [ ] INPUT consolidation applied (multiple keystrokes → final value)
   - [ ] No unnecessary navigation steps
   - [ ] SCROLL consolidation applied

**Issue Tracking**:
- Missing labels: _______________________________
- Wrong input types: ____________________________
- Incomplete dropdown options: __________________
- Other: _______________________________________

---

### Phase 3: Execute - Replay with Different Data

**Test Name**: `{CRM_NAME}_new_lead_replay`

**Test Data Set 1**:
- First Name: `John`
- Last Name: `Smith`
- Email: `john.smith@acme.com`
- Phone: `(555) 234-5678`
- Company: `Acme Corp`

**Test Data Set 2**:
- First Name: `Jane`
- Last Name: `Doe`
- Email: `jane.doe@techcorp.com`
- Phone: `(555) 345-6789`
- Company: `TechCorp Inc`

**Execution Steps**:

1. **Open Workflow**
   - Click workflow in extension
   - Form should appear with variable fields

2. **Fill Variables**
   - Enter Test Data Set 1
   - Verify all fields are editable
   - Check that default values are cleared

3. **Execute Workflow**
   - Click "Execute" button
   - Monitor progress in extension
   - Watch automation in browser

4. **Verify Success**
   - [ ] Workflow completed without errors
   - [ ] Contact/Lead was created in CRM
   - [ ] All fields have correct values
   - [ ] No duplicate records created

5. **Repeat with Test Data Set 2**
   - Execute again with different data
   - Verify consistency

**Issue Tracking**:
- Element not found: ____________________________
- Wrong element clicked: ________________________
- Dropdown selection failed: ____________________
- Timing issues (too fast/slow): ________________
- Other: _______________________________________

---

## Platform-Specific Test Plans

### Salesforce Lightning

**Known Challenges**:
- Shadow DOM components
- Picklist (dropdown) custom components
- Modal dialogs for inline editing
- Long page load times (500ms+ wait needed)

**Additional Test Cases**:

1. **Picklist Selection**
   - Test Status picklist
   - Test Lead Source picklist  
   - Test custom picklists
   - Verify cached value is used

2. **Lookup Fields**
   - Test Account lookup
   - Verify search and selection
   - Check if modal appears

3. **Shadow DOM Inputs**
   - Verify `capturedInputDetails` path works
   - Check label detection in Shadow DOM
   - Test complex Lightning Web Components

**Salesforce-Specific Checks**:
- [ ] `isSalesforcePicklist` detection works
- [ ] Cached picklist values used correctly
- [ ] Lightning page fully rendered before action
- [ ] Navigation between tabs works
- [ ] Related lists don't interfere

---

### HubSpot

**Known Challenges**:
- React portals for modals
- Custom dropdown components (not standard `<select>`)
- Auto-save behavior on blur
- Loading spinners between saves

**Additional Test Cases**:

1. **Association Modals**
   - Test Company association
   - Test Deal association
   - Verify modal appears and closes

2. **Property Dropdowns**
   - Test Lifecycle Stage
   - Test Lead Status
   - Test custom properties

3. **Multi-Select Properties**
   - Test checkbox groups
   - Verify all selections captured
   - Check replay accuracy

**HubSpot-Specific Checks**:
- [ ] Modal detection works
- [ ] Auto-save triggers detected
- [ ] Spinner wait logic applied
- [ ] Property panel navigation works
- [ ] Timeline updates don't block

---

### Pipedrive

**Known Challenges**:
- Pipeline stage changes (drag or dropdown)
- Activity logging in sidebar
- Quick add vs full form
- Inline editing in list view

**Additional Test Cases**:

1. **Pipeline Management**
   - Test stage dropdown
   - Test moving between pipelines
   - Verify stage is saved correctly

2. **Activity Logging**
   - Test adding activity
   - Test due date selection
   - Verify activity appears

3. **Organization Association**
   - Test linking to organization
   - Verify search works
   - Check new organization creation

**Pipedrive-Specific Checks**:
- [ ] Stage dropdown detected correctly
- [ ] Activity sidebar works
- [ ] Organization search functions
- [ ] Value/currency fields work
- [ ] Custom fields captured

---

## Common Issues & Solutions

### Issue: Element Not Found

**Symptoms**: "Element not found" error during replay

**Debug Steps**:
1. Check if page fully loaded before action
2. Verify selector is still valid (inspect element)
3. Check if element is in Shadow DOM
4. Review `locatorBundle` strategies

**Solutions**:
- Add wait condition before step
- Update selector to more stable attribute
- Enable Shadow DOM piercing
- Add scope/container hint

---

### Issue: Wrong Element Clicked

**Symptoms**: Automation clicks different element than expected

**Debug Steps**:
1. Check if multiple elements match selector
2. Verify `disambiguators` are unique enough
3. Check element visibility (z-index, modal overlays)
4. Review `interactionType` detection

**Solutions**:
- Add more specific disambiguator
- Add scope hint (container/widget)
- Increase specificity of selector
- Check modal detection logic

---

### Issue: Dropdown Selection Failed

**Symptoms**: Dropdown doesn't open or option not selected

**Debug Steps**:
1. Verify dropdown is detected as `DROPDOWN_SELECTION`
2. Check if options were captured during recording
3. Verify dropdown trigger click works
4. Check timing between trigger click and option click

**Solutions**:
- Re-record with explicit pause after dropdown opens
- Verify `dropdown.options` array is populated
- Add `waitForDropdownMenu` before option selection
- Check `MenuDetector` logs

---

### Issue: Timing Problems

**Symptoms**: Actions happen too fast, elements not ready

**Debug Steps**:
1. Check `StateWaitEngine` logs
2. Verify network idle detection
3. Check DOM stability waits
4. Review page-specific wait times

**Solutions**:
- Increase `maxWaitMs` in StateWaitEngine config
- Add explicit wait condition
- Detect spinners/loading indicators
- Platform-specific waits (Salesforce: 500ms+)

---

## Success Criteria

A CRM platform is considered **fully supported** when:

- [x] **Recording**: 95%+ of form fields captured correctly
- [x] **Variable Detection**: 90%+ of inputs identified as variables
- [x] **Dropdowns**: 100% of dropdown options captured
- [x] **Labels**: 90%+ of fields have human-readable labels
- [x] **Replay**: 95%+ success rate across 10+ test executions
- [x] **Optimization**: 40%+ reduction in step count
- [x] **Self-Healing**: Works after minor UI updates
- [x] **Documentation**: Platform-specific quirks documented

---

## Test Report Template

### Test Execution Report

**Platform**: ________________  
**Extension Version**: ________________  
**Date**: ________________  
**Tester**: ________________

#### Recording Phase
- Steps Captured: _____ / _____
- Variables Detected: _____ / _____
- Labels Missing: _____ / _____
- Dropdowns Captured: _____ / _____

#### Optimization Phase
- Original Steps: _____
- Optimized Steps: _____
- Reduction: _____%

#### Replay Phase (10 executions)
- Success Rate: _____ / 10 (____%)
- Average Time: _____ seconds
- Failures: _____

#### Issues Found
1. _____________________________________________
2. _____________________________________________
3. _____________________________________________

#### Workarounds Applied
1. _____________________________________________
2. _____________________________________________

#### Overall Status
- [ ] Passed - Ready for production
- [ ] Passed with Issues - Workarounds documented
- [ ] Failed - Major issues blocking usage

---

## Next Steps

After completing testing:

1. **Document Findings**
   - Create platform-specific MD file (e.g., `SALESFORCE_TESTING_RESULTS.md`)
   - Include screenshots of issues
   - List all workarounds

2. **File Issues**
   - Create GitHub issues for blocking bugs
   - Tag with platform name
   - Include reproduction steps

3. **Update Code**
   - Add platform-specific detection if needed
   - Improve selectors for common patterns
   - Update documentation

4. **Regression Testing**
   - Re-test after fixes
   - Verify existing functionality still works
   - Test on different user roles/permissions

---

**Version**: 1.0  
**Last Updated**: January 2026  
**Author**: Mimoai Team
