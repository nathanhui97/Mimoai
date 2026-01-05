# mimoai

**Turn repetitive browser tasks into reusable "Micro-Apps" instantly.**

mimoai is a Chrome Extension that revolutionizes browser automation by using AI to understand user intent and automatically generate user-friendly forms for repetitive tasks. Unlike traditional macro recorders that play back static scripts, mimoai watches you perform a task once, understands the context, and creates an intuitive form interface for future executions.

## 🚀 Core Innovation

### Semantic Recording
We capture the human context of elements (labels, placeholders, surrounding text) rather than brittle CSS selectors. This makes workflows resilient to UI changes.

### Auto-Parameterization
The AI automatically deduces variables from your actions (e.g., recognizing "New York" as a search term) and builds appropriate form inputs for them.

### Resilient Replay
The execution engine adapts to UI changes using semantic matching, ensuring your workflows continue to work even when websites update their design.

## 📖 User Journey

### Step 1: The "Teach" Phase (Recording)

1. Open the extension side panel and click **"Create New Workflow"**
2. Name your workflow (e.g., "Send Invoice")
3. Interact with the webpage naturally:
   - Click "New Invoice"
   - Type "Acme Corp" into the Client field
   - Type "500" into the Amount field
   - Click "Send"

**Behind the scenes:** The extension records all events and scrapes the DOM around inputs to capture contextual labels like "Client Name" and "Total Amount".

### Step 2: The "Build" Phase (AI Analysis)

1. Click **"Stop & Save"**
2. The raw event log is sent to AI (OpenAI GPT-4o) for analysis
3. The AI generates a JSON Schema for a form based on detected variables:
   - `variable_1`: Label="Client Name", Type="Text", Default="Acme Corp"
   - `variable_2`: Label="Invoice Amount", Type="Number", Default="500"

### Step 3: The "Run" Phase (Form Interaction)

1. See your workflow card in the library: **"Send Invoice"**
2. Click it to open a clean, dynamically generated form:
   ```
   [Input Box] Client Name
   [Input Box] Invoice Amount
   ```
3. Fill in new values (e.g., "Wayne Enterprises" and "1000")
4. Click **"Run Automation"**

### Step 4: The "Act" Phase (Execution)

The extension:
- Navigates to the target URL
- Finds form elements using semantic matching (even if IDs changed)
- Fills in the new data
- Completes the workflow automatically

## 🎯 Key Features

- **No Code Required**: Users interact with simple forms, not scripts
- **AI-Powered Understanding**: Automatically identifies variables and creates appropriate inputs
- **Semantic Matching**: Works even when websites update their UI
- **User-Friendly Interface**: Clean, intuitive form-based workflow execution
- **Context-Aware Recording**: Captures labels and surrounding context for better reliability

## 🛠️ Technology Stack

- **Frontend**: React + TypeScript + Vite
- **AI**: OpenAI GPT-4o
- **Platform**: Chrome Extension

## 📦 Installation

```bash
npm install
```

## 🚀 Development

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Lint code
npm run lint
```

## 🔒 Security

This project follows security best practices for API key management:

- ✅ **No API keys in client-side code** - All Gemini API calls go through Supabase Edge Functions
- ✅ **Server-side only** - API keys are stored in Supabase secrets, never in source code
- ✅ **Never exposed to GitHub** - All API keys come from Supabase secrets, never committed
- ✅ **Secure deployment** - Deployment scripts use environment variables, never hardcoded keys
- ✅ **Git protection** - `.gitignore` configured to prevent accidental commits of secrets

**Verify security before committing:**
```bash
./verify-security.sh
```

See [SECURITY_GUIDE.md](./SECURITY_GUIDE.md) for detailed security information and setup instructions.

## 📝 License

Private project - All rights reserved
