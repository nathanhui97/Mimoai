# mimoai - Product Description

## 🎯 What We're Building

**mimoai** is an AI-powered Chrome Extension that transforms repetitive browser tasks into reusable, intelligent workflows. It's designed to make browser automation accessible to everyone—no coding required.

### The Core Problem We Solve

Every day, people perform the same repetitive tasks in their browsers:
- Filling out forms with similar information
- Navigating through multi-step processes
- Entering data into spreadsheets or databases
- Completing routine workflows across different websites

Traditional automation tools require technical knowledge, break when websites change, and don't understand context. GhostWriter solves this by using AI to understand what you're doing and create smart, self-healing workflows.

---

## 💡 Core Value Proposition

**"Turn repetitive browser tasks into reusable Micro-Apps instantly."**

Watch yourself perform a task once, and GhostWriter creates an intelligent form interface that lets you repeat that task with different data—even when websites update their UI.

---

## 🚀 How It Works

### 1. **Record** (The "Teach" Phase)
- Click "Start Recording" in the extension sidepanel
- Perform your task naturally in the browser:
  - Click buttons, fill forms, navigate pages
  - The extension captures everything: clicks, inputs, navigation, context
- Click "Stop Recording" when done

**What happens behind the scenes:**
- Records all user interactions (clicks, inputs, keyboard, navigation)
- Captures semantic context (labels, placeholders, surrounding text)
- Takes visual snapshots for AI understanding
- Generates stable selectors with multiple fallback options
- Detects wait conditions automatically

### 2. **Analyze** (The "Build" Phase)
- AI automatically analyzes your recorded workflow
- Detects which values should be variables (e.g., "Acme Corp" → Client Name field)
- Creates a dynamic form schema with appropriate input types
- Translates steps into natural language descriptions
- Validates and improves selectors proactively

**What happens behind the scenes:**
- Variable detection using AI vision analysis
- Natural language translation of workflow steps
- Selector validation and improvement
- Navigation optimization (removes unnecessary steps)
- Workflow intent analysis

### 3. **Execute** (The "Run" Phase)
- See your workflow in the library
- Click to open a clean, dynamically generated form
- Fill in new values for the detected variables
- Click "Execute" to run the automation

**What happens behind the scenes:**
- Navigates to the starting URL
- Finds elements using 9 different strategies (semantic matching, AI recovery)
- Fills in form data with your new values
- Handles wait conditions and page transitions
- Adapts to UI changes using AI-powered element recovery
- Completes the entire workflow automatically

---

## 🎯 Key Features

### 1. **Semantic Recording**
Unlike traditional macro recorders that rely on brittle CSS selectors, GhostWriter captures:
- **Human context**: Labels, placeholders, surrounding text
- **Visual snapshots**: Screenshots for AI understanding
- **Element relationships**: How elements relate to each other
- **State tracking**: Page state before and after actions

This makes workflows resilient to UI changes—if a website redesigns, GhostWriter can still find the right elements.

### 2. **AI-Powered Intelligence**

#### **Variable Detection**
- Automatically identifies which values should be variables
- Recognizes patterns (emails, names, amounts, dates)
- Creates appropriate input types (text, number, email, dropdown)
- Shows confidence scores and reasoning

#### **Element Recovery**
- When selectors fail, AI analyzes the page visually
- Uses multimodal AI (text + images) to find elements
- Two-tier caching for performance
- PII scrubbing for privacy

#### **Selector Validation**
- Proactively detects fragile selectors during recording
- AI suggests better alternatives in the background
- Automatically improves selectors before saving
- Non-blocking (doesn't slow down recording)

### 3. **Multi-Strategy Element Finding**
When executing, GhostWriter tries 9 different strategies to find elements:
1. Primary selector (best stable selector)
2. Fallback selectors (backup options)
3. XPath text matching
4. Label-based finding
5. Context-based matching
6. Similarity matching
7. Visual snapshot matching
8. Coordinate-based fallback
9. **AI Element Recovery** (when all else fails)

### 4. **Visual Intelligence**
- Page type classification (form, dashboard, table, etc.)
- Visual importance scoring
- Visual flow tracking (before/after states)
- Human-like understanding of page layouts

### 5. **No-Code Interface**
- Simple, intuitive sidepanel UI
- Form-based workflow execution
- Visual workflow step display
- Editable AI instructions
- Screenshot viewer for debugging

### 6. **Self-Healing Workflows**
- Adapts to UI changes automatically
- Learns from user corrections
- Improves over time
- Works even when websites update

---

## 🎨 User Experience

### For Non-Technical Users
- **Simple**: Record once, run many times
- **Visual**: See your workflow steps with screenshots
- **Intuitive**: Fill out forms, not write code
- **Reliable**: Works even when websites change

### For Power Users
- **Editable**: Modify AI-generated instructions
- **Optimizable**: Toggle between original and optimized workflows
- **Debuggable**: View screenshots, selectors, and execution logs
- **Flexible**: Export workflows as JSON

---

## 🏗️ Technical Architecture

### Frontend
- **React 19.2.0** with TypeScript
- **Chrome Extension** (Manifest V3)
- **Tailwind CSS** for styling
- **Zustand** for state management

### Backend & AI
- **Google Gemini 2.5 Flash** for AI processing
- **Supabase Edge Functions** for serverless AI calls
- **PostgreSQL** for AI response caching
- **Secure**: All API keys server-side only

### Key Components
- **Content Script**: Records interactions, executes workflows
- **Side Panel**: React UI for workflow management
- **Service Worker**: Background coordination
- **Edge Functions**: AI processing (element recovery, variable detection)

---

## 🔒 Security & Privacy

- ✅ **No API keys in client code** - All AI calls through Supabase
- ✅ **PII scrubbing** - Removes sensitive data before AI calls
- ✅ **Local-first** - Workflows stored locally in browser
- ✅ **Secure deployment** - API keys in Supabase secrets only

---

## 📊 Use Cases

### Business Automation
- **Invoice Processing**: Fill out invoices with different client data
- **Data Entry**: Enter data into CRM systems, spreadsheets
- **Form Submissions**: Submit applications, registrations
- **Report Generation**: Navigate dashboards and generate reports

### Personal Productivity
- **Shopping**: Fill out checkout forms with saved addresses
- **Booking**: Book appointments, reservations
- **Research**: Automate repetitive research tasks
- **Social Media**: Post content across platforms

### Testing & QA
- **Regression Testing**: Automate test scenarios
- **Data Validation**: Verify form submissions
- **User Journey Testing**: Test complete workflows

---

## 🎯 Target Users

### Primary Users
- **Business Professionals**: People who perform repetitive browser tasks daily
- **Data Entry Workers**: Those who enter data into systems regularly
- **Small Business Owners**: Managing multiple online processes
- **Non-Technical Users**: Want automation without coding

### Secondary Users
- **Developers**: Testing workflows, debugging
- **QA Engineers**: Automated testing scenarios
- **Power Users**: Advanced workflow customization

---

## 🌟 What Makes It Different

### vs. Traditional Macro Recorders
- ✅ **Semantic understanding** (not just CSS selectors)
- ✅ **AI-powered recovery** (works when UI changes)
- ✅ **Variable detection** (automatic parameterization)
- ✅ **Visual intelligence** (understands page context)

### vs. RPA Tools
- ✅ **No installation** (Chrome extension)
- ✅ **No coding** (form-based interface)
- ✅ **Affordable** (no enterprise pricing)
- ✅ **Fast setup** (record in seconds)

### vs. Browser Extensions
- ✅ **AI-powered** (intelligent, not just recording)
- ✅ **Self-healing** (adapts to changes)
- ✅ **User-friendly** (forms, not scripts)
- ✅ **Reliable** (multiple fallback strategies)

---

## 📈 Current Status

### Production-Ready Features
- ✅ Core recording and execution
- ✅ AI element recovery
- ✅ Variable detection and parameterization
- ✅ Visual intelligence
- ✅ Multi-level execution fallback
- ✅ Workflow storage and management

### In Development
- 🔄 Enhanced UI/UX (separate repository)
- 🔄 Advanced workflow analytics
- 🔄 Multi-tab orchestration improvements
- 🔄 Performance optimizations

---

## 🎨 Design Philosophy

### User-Centric
- **Simple**: Easy to understand and use
- **Visual**: See what's happening at each step
- **Forgiving**: Works even when things change
- **Helpful**: AI guides and improves workflows

### Technical Excellence
- **Reliable**: Multiple fallback strategies
- **Performant**: Caching, optimization
- **Secure**: Privacy-first, server-side AI
- **Maintainable**: Clean architecture, TypeScript

---

## 🚀 Vision

**Make browser automation as easy as filling out a form.**

GhostWriter aims to democratize browser automation, making it accessible to everyone—not just developers. By combining semantic understanding, AI intelligence, and a user-friendly interface, we're creating the future of browser automation.

---

## 📝 Summary

GhostWriter is an AI-powered Chrome Extension that:
1. **Records** your browser actions with semantic understanding
2. **Analyzes** workflows to detect variables and improve reliability
3. **Executes** tasks intelligently, adapting to UI changes
4. **Learns** from corrections and improves over time

It's designed for non-technical users who want to automate repetitive browser tasks without writing code, while providing enough power and flexibility for advanced users.

**The result**: Turn any repetitive browser task into a reusable, intelligent workflow that works reliably—even when websites change.

---

*Last Updated: December 2025*



