# Implementation Plan: Rahi AI Web Browser Agent

> **Status:** Draft / Active  
> **Target Version:** Manifest V3 (Chrome 116+)  
> **References:** [problemstatement.md](file:///d:/My%20Projects/Massai%20Live%20Project%20Course/Masai%20October%20Project/Ai%20Web%20Browser/problemstatement.md) | [architecture.md](file:///d:/My%20Projects/Massai%20Live%20Project%20Course/Masai%20October%20Project/Ai%20Web%20Browser/architecture.md)

**Goal:** Build and ship Rahi, a production-grade Chrome Side-Panel AI Agent that reads, understands, reasons about, and acts upon web pages with strict human approval, deterministic safety boundaries, and free-tier resilience across 4 structured phases.

**Architecture:** Chrome Extension Manifest V3 utilizing the native `chrome.sidePanel` API, isolated Shadow DOM overlays for element badges and screenshot crop selection, resilient `chrome.storage.local` task state hydration, streaming via long-lived runtime message ports, and a dual-engine AI gateway (Gemini Flash-Lite primary, Gemini Flash for vision, Groq text fallback on HTTP 429).

**Tech Stack:** Vanilla JavaScript (ES6+ Modules), HTML5, Pure Modern CSS (DevTools-inspired compact productivity theme), Mozilla Readability.js, Chrome Extension APIs (`sidePanel`, `storage`, `tabs`, `scripting`, `contextMenus`, `runtime`), Google Gemini API (`gemini-2.5-flash-lite`, `gemini-2.5-flash`), Groq API (`llama-3.3-70b-versatile`).

---

## Plan Overview & Phase Milestones

```
Phase 1: Week 1 - The Eyes (Read the Web)
├── Slice 1.1: Extension Shell, Manifest V3, Side Panel Container & Settings
├── Slice 1.2: AI Gateway (Gemini Flash-Lite) & Language Switcher (En/Hinglish)
├── Slice 1.3: Mozilla Readability Content Extraction & Article Summarizer
└── Slice 1.4: Public YouTube Native Summarizer with Clickable Timestamp Deep Links

Phase 2: Week 2 - The Brain (Understand Page & Screen)
├── Slice 2.1: Grounded Page Chat with Sliding Window History & Streaming Port
├── Slice 2.2: Context Menu AI Actions (Explain, Translate, Draft Reply)
├── Slice 2.3: Screenshot-and-Ask with Viewport Drag-to-Crop Canvas Overlay
└── Slice 2.4: Free-Tier Resilience Gateway (Groq Fallback & Exponential Backoff)

Phase 3: Week 3 - The Hands (Act with User Approval)
├── Slice 3.1: Interactive Element Scanner & Compact Action Map Manifest
├── Slice 3.2: Shadow DOM Numbered Badges Overlay (#rahi-badge-root)
├── Slice 3.3: "Find It for Me" Element Query & Pulse Highlight Flow
├── Slice 3.4: Strict Action Decision Schema Validator & Sanitizer
├── Slice 3.5: Side Panel Action Approval Card & Execution Controls
├── Slice 3.6: Deterministic Synthetic DOM Event Executor
└── Slice 3.7: One-Step Agent Loop State Machine & Service Worker Rehydration

Phase 4: Week 4 - Memory, Safety, and Shipping
├── Slice 4.1: Local User Profile Storage & Form-Fill Integration
├── Slice 4.2: One-Click Skills Hub with Import/Export (rahi-skills-v1)
├── Slice 4.3: Hardcoded Security Guardrails (Domain Firewall & Element Sentinel)
├── Slice 4.4: Controlled Practice Errand Environments & End-to-End Test Suite
└── Slice 4.5: Packaging, .gitignore, README.md, Release ZIP & Landing Page
```

---

## Phase 1: Week 1 — The Eyes: Read the Web

### Task 1.1: Extension Scaffolding & Manifest V3 Core
**Objective:** Create the foundational Chrome MV3 extension structure that loads cleanly via `chrome://extensions` with an operational side panel and settings persistence.

**Files:**
- Create: `manifest.json`
- Create: `icons/icon16.png`, `icons/icon32.png`, `icons/icon48.png`, `icons/icon128.png`
- Create: `sidepanel/sidepanel.html`
- Create: `sidepanel/sidepanel.css`
- Create: `sidepanel/sidepanel.js`
- Create: `background/service_worker.js`

**Step 1: Create Manifest V3 configuration**
- Configure `manifest_version: 3`, name `"Rahi - AI Web Browser Agent"`, version `"1.0.0"`.
- Declare permissions: `["sidePanel", "storage", "activeTab", "scripting", "contextMenus"]`.
- Set background service worker: `{"service_worker": "background/service_worker.js", "type": "module"}`.
- Configure `side_panel: {"default_path": "sidepanel/sidepanel.html"}`.
- Bind action click to open side panel: `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.

**Step 2: Build Side Panel UI Container & Tab Shell**
- Implement semantic HTML layout in `sidepanel/sidepanel.html`:
  - Header: Logo, Status indicator (Online/API Key Configured), Navigation Tabs (`Chat`, `Summary`, `Agent`, `Skills`, `Profile`, `Settings`).
  - Main Body: View containers with active view switching via data attributes.
  - Footer: Language Toggle (`English` / `Hinglish`), Model indicator badge.
- Implement `sidepanel.css`: Information-dense, neutral slate palette (`#0f172a`, `#1e293b`, `#334155`, `#f8fafc`), clean typography (`Inter`, `system-ui`), high-contrast buttons, zero decorative distractions.

**Step 3: Implement Settings Storage & Key Management**
- In `sidepanel.js`, build event handlers for saving Gemini API key and model selection.
- Persist into `chrome.storage.local` under `settings`:
  ```javascript
  {
    geminiApiKey: "AIzaSy...",
    groqApiKey: "",
    preferredLanguage: "en",
    defaultModel: "gemini-2.5-flash-lite",
    maxStepLimit: 15,
    enableDryRunDefault: false
  }
  ```
- Add masked input view with Show/Hide toggle and "Save & Test Key" validation button.

**Step 4: Verification Check**
- Load unpacked in Chrome (`chrome://extensions`).
- Open developer console on Service Worker and Side Panel.
- Save dummy key and verify persistence across browser refresh in `chrome.storage.local`.

---

### Task 1.2: AI Gateway Client & Language Switcher
**Objective:** Implement direct REST client in `background/ai_gateway.js` communicating with Gemini API with language conditioning.

**Files:**
- Create: `background/ai_gateway.js`
- Modify: `background/service_worker.js`
- Modify: `sidepanel/sidepanel.js`

**Step 1: Implement Gemini REST API Client**
- Build `generateText({ apiKey, model, systemInstruction, prompt, temperature })` targeting endpoint:
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
- Implement structured payload formatting conforming to Google AI Studio v1beta API:
  ```javascript
  {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: { temperature: temperature ?? 0.2, maxOutputTokens: 2048 }
  }
  ```

**Step 2: Language Switching Prompt Decorator**
- Support two target modes:
  - `en`: Clear, concise, standard professional English.
  - `hinglish`: Conversational Indian English with natural Hindi colloquial markers (e.g., "Is page par application form available hai, aap niche diye button ko click karke continue kar sakte hain").
- Inject language instructions into every prompt conditioning block.

**Step 3: Side Panel Language Toggle Wiring**
- Wire UI toggle in `sidepanel.js` to dispatch state update:
  `chrome.storage.local.set({ "settings.preferredLanguage": lang })`
- Update UI pills dynamically to highlight active selection.

**Step 4: Verification Check**
- Send test prompt "Hello, who are you?" from Side Panel test button.
- Verify English response returns in `en` mode.
- Switch to `hinglish` and verify response adopts natural bilingual phrasing.

---

### Task 1.3: Mozilla Readability Article Extraction & Structured Summarizer
**Objective:** Cleanly extract page article text, discarding ads, footers, and menus, and generate structured summaries.

**Files:**
- Create: `lib/readability.js` (bundled Mozilla Readability standard library)
- Create: `content/extractor.js`
- Create: `sidepanel/components/summary.js`
- Modify: `background/service_worker.js`
- Modify: `sidepanel/sidepanel.html`

**Step 1: Integrate Mozilla Readability in Content Script**
- In `content/extractor.js`, listen for `action: "EXTRACT_CONTENT"`.
- Clone active `document` and run `new Readability(documentClone).parse()`.
- Return clean structured object:
  ```javascript
  {
    title: article.title || document.title,
    byline: article.byline,
    textContent: article.textContent.trim(),
    length: article.length,
    url: window.location.href
  }
  ```

**Step 2: Structured Summarization Prompting**
- In `background/service_worker.js`, on receiving summary request:
  - Request extracted text from active tab via `chrome.tabs.sendMessage`.
  - Format prompt requesting strict JSON summary output:
    ```json
    {
      "tldr": "One sentence summary capturing the main core takeaway",
      "points": ["Key takeaway 1", "Key takeaway 2", "Key takeaway 3", "Key takeaway 4", "Key takeaway 5"],
      "nextSteps": ["Actionable next step or key implication 1", "Actionable next step 2"]
    }
    ```

**Step 3: Side Panel Summary Card Rendering**
- In `sidepanel/components/summary.js`, display:
  - Header with Article Title & Source Domain badge.
  - **TL;DR** card highlighted with accent border.
  - **5 Key Points** as clean bulleted list with copy-to-clipboard button.
  - **What To Do Next** actionable checklist.
  - Export as Markdown button.

**Step 4: Verification Check**
- Navigate to Wikipedia and TechCrunch articles.
- Click "Summarise Page".
- Verify non-article elements (navbars, ads) are absent and summary renders within 3 seconds.

---

### Task 1.4: Public YouTube Summarizer with Timestamp Deep Links
**Objective:** Summarize public YouTube videos directly using Gemini URL processing and output chapter notes with clickable deep links.

**Files:**
- Create: `background/youtube_handler.js`
- Modify: `sidepanel/components/summary.js`
- Modify: `background/service_worker.js`

**Step 1: URL Detection & Validation**
- Detect whether active page or user input matches YouTube video pattern:
  `^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})`
- Extract clean `videoId`.

**Step 2: Gemini Direct Video Processing**
- Construct Gemini prompt with YouTube URL:
  ```javascript
  prompt: `Analyze this public YouTube video: https://www.youtube.com/watch?v=${videoId}
  Provide a concise structured summary with chapters and exact timestamps in seconds.`
  ```
- Require structured output:
  ```json
  {
    "tldr": "...",
    "chapters": [
      { "timestampSeconds": 45, "timestampLabel": "00:45", "title": "Introduction", "summary": "..." }
    ]
  }
  ```

**Step 3: Clickable Deep-Link Generation**
- Render each timestamp as an actionable anchor:
  `<a class="timestamp-link" data-time="45" href="https://youtube.com/watch?v=${videoId}&t=45s">00:45</a>`
- Clicking sends `chrome.tabs.update(activeTabId, { url: targetUrl })` or executes `document.querySelector('video').currentTime = seconds` if on the same tab.

**Step 4: Unsupported Video Graceful Fallback**
- Catch Gemini 400/404 errors for private/unlisted/restricted videos.
- Display clear message: *"This video is not supported for summarization. It may be private or restricted."*

---

## Phase 2: Week 2 — The Brain: Understand the Page and the Screen

### Task 2.1: Grounded Page Chat & Long-Lived Streaming Port
**Objective:** Enable real-time streaming conversational Q&A strictly grounded in the extracted page context with persistent sliding-window chat history.

**Files:**
- Create: `sidepanel/components/chat.js`
- Modify: `background/service_worker.js`
- Modify: `background/ai_gateway.js`

**Step 1: Implement Long-Lived Port for Streaming (`ADR-005`)**
- In `sidepanel/components/chat.js`, connect port: `const port = chrome.runtime.connect({ name: "rahi-stream" })`.
- Listen for chunk events: `port.onMessage.addListener(msg => { if (msg.type === "CHUNK") appendToken(msg.text); })`.
- In `background/ai_gateway.js`, connect to Gemini stream endpoint:
  `.../models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`
- Parse Server-Sent Events (SSE) stream buffer and push parsed deltas over port.

**Step 2: Context Grounding System Prompt**
- Format system instruction enforcing strict containment:
  - If content is in `[PAGE CONTEXT]`, cite and answer concisely.
  - If NOT present, reply exactly: *"I couldn't find that information on this page."*
  - Zero external hallucinations.

**Step 3: Tab-Scoped Sliding Window History**
- Key history by `${tabId}:${urlOriginPathname}` in `chrome.storage.local.chatSessions`.
- Maintain up to 20 user/assistant message pairs.
- Invalidate/clear history automatically when tab navigates to a different origin/pathname.
- On tab closed (`chrome.tabs.onRemoved`), clean up storage key.

**Step 4: Verification Check**
- Test with an FAQ page. Ask questions present on the page; verify quick streaming answers.
- Ask an unrelated world knowledge question (e.g. "What is the capital of France?" on a recipe page); verify refusal: *"I couldn't find that information on this page."*

---

### Task 2.2: Context Menu AI Actions (Explain, Translate, Draft Reply)
**Objective:** Add right-click browser context menus for selected text that deliver instant answers to the side panel.

**Files:**
- Create: `background/context_menus.js`
- Modify: `background/service_worker.js`
- Modify: `sidepanel/sidepanel.js`

**Step 1: Context Menu Registration**
- In `background/context_menus.js`, register on `chrome.runtime.onInstalled`:
  - `rahi_explain`: "Explain with Rahi" (contexts: `["selection"]`)
  - `rahi_translate`: "Translate with Rahi" (contexts: `["selection"]`)
  - `rahi_reply`: "Draft Reply with Rahi" (contexts: `["selection"]`)

**Step 2: Menu Trigger Dispatcher**
- Listen via `chrome.contextMenus.onClicked.addListener`.
- Open side panel programmatically on the current tab: `chrome.sidePanel.open({ tabId: tab.id })`.
- Send menu payload to Side Panel: `{ action: "CONTEXT_ACTION", mode: info.menuItemId, selection: info.selectionText }`.

**Step 3: Action Execution in Side Panel**
- Automatically populate chat container with the query and trigger corresponding system prompt:
  - Explain: "Explain this technical/dense passage in simple words."
  - Translate: "Translate the selected passage into Hindi / English."
  - Draft Reply: "Draft a professional, helpful response to this message using user profile context."

**Step 4: Verification Check**
- Highlight text on any page, right click, click "Explain with Rahi".
- Verify Side Panel pops open and streams the simplified explanation.

---

### Task 2.3: Screenshot-and-Ask with Canvas Crop Overlay (`ADR-006`)
**Objective:** Enable visual queries on charts, errors, and diagrams using temporary drag-to-select canvas crop and Gemini Vision.

**Files:**
- Create: `content/screenshot_crop.js`
- Modify: `content/content.js`
- Modify: `background/service_worker.js`
- Modify: `sidepanel/components/chat.js`

**Step 1: Viewport Capture Coordinator**
- When user clicks "Ask about screen" in Side Panel:
- Service worker calls `chrome.tabs.captureVisibleTab(null, { format: "png" })`.
- Sends full base64 image to content script: `{ action: "SHOW_CROP_OVERLAY", image: dataUrl }`.

**Step 2: Interactive Canvas Crop Overlay**
- In `content/screenshot_crop.js`, inject full-screen fixed canvas (`z-index: 2147483647`).
- Render darkened overlay with crosshair cursor.
- Track `mousedown`, `mousemove`, `mouseup` to draw dynamic selection rectangle.
- Draw selected region to offscreen canvas and export cropped base64 PNG data.
- Support `Escape` key to cancel and full-screen Enter fallback.
- Auto-remove canvas from DOM immediately after export.

**Step 3: Multimodal Gemini Vision Dispatch**
- Send cropped base64 + user question to Gemini Flash (`gemini-2.5-flash`):
  ```javascript
  contents: [{
    parts: [
      { inlineData: { mimeType: "image/png", data: base64Only } },
      { text: `Question about this screenshot: ${question}` }
    ]
  }]
  ```

**Step 4: Verification Check**
- Open a financial chart or complex diagram.
- Trigger screenshot query, crop the chart region, and ask "What was the highest peak in this graph?".
- Verify accurate visual reasoning returned.

---

### Task 2.4: Free-Tier Resilience & Multi-Provider Failover Gateway (`ADR-004`)
**Objective:** Implement automatic retry with exponential backoff on HTTP 429 and transparent fallback to Groq free tier.

**Files:**
- Modify: `background/ai_gateway.js`
- Modify: `sidepanel/sidepanel.html` (API Key settings for Groq)

**Step 1: HTTP 429 Retry Engine with Exponential Backoff**
- Wrap fetch requests in retry loop:
  - If response status is 429:
  - Read `Retry-After` header or calculate exponential jitter: `delay = Math.min(1000 * 2 ** attempt + Math.random() * 500, 10000)`.
  - Max retries: 2.

**Step 2: Transparent Groq Failover Client**
- If Gemini quota fails after retries:
- Check if text task (summary, chat, action planning) and `groqApiKey` configured.
- Route request to Groq OpenAI-compatible endpoint:
  `https://api.groq.com/openai/v1/chat/completions` with model `llama-3.3-70b-versatile`.
- Display subtle status badge in UI: *"Switched to Groq Fallback (Gemini busy)"*.

**Step 3: Clean Error State UI**
- If all providers exhausted, show actionable user card: *"Free-tier rate limit reached. Please wait 30 seconds or configure Groq fallback key in Settings."*

---

## Phase 3: Week 3 — The Hands: Act With User Approval

### Task 3.1: Interactive Element Scanner & Compact Action Map
**Objective:** Traverse DOM to detect clickable/fillable elements and serialize into an ultra-compact JSON manifest.

**Files:**
- Create: `content/scanner.js`
- Modify: `content/content.js`

**Step 1: Visible Interactive DOM Traversal**
- Query candidate elements:
  `button, a[href], input:not([type="hidden"]), textarea, select, [role="button"], [role="link"], [role="checkbox"], [tabindex]:not([tabindex="-1"])`
- Check element visibility:
  - `offsetWidth > 0 && offsetHeight > 0`
  - `getComputedStyle(el).visibility !== "hidden"`
  - `getComputedStyle(el).display !== "none"`
  - `getComputedStyle(el).opacity !== "0"`
  - Element within or near visible viewport.

**Step 2: Assign Stable Sequential IDs**
- Store elements in content script memory array: `window.__rahiScannedElements = []`.
- Assign 1-indexed ID (`1, 2, 3...`) matching visual badges.

**Step 3: Serialize Compact Action Map**
- Extract label via hierarchy: `aria-label` → `aria-labelledby` → associated `<label>` → inner text → `placeholder` → `title`.
- Build compact JSON manifest (under 80 bytes per element):
  ```json
  { "id": 1, "type": "input_text", "label": "Full Name", "placeholder": "Enter name", "value": "" }
  ```

---

### Task 3.2: Shadow DOM Numbered Badges Overlay (`ADR-002`)
**Objective:** Render floating numbered badges above interactive elements inside an isolated Shadow DOM container.

**Files:**
- Create: `content/badge_overlay.js`
- Modify: `content/content.js`

**Step 1: Encapsulated Shadow Host Injection**
- Create `#rahi-badge-root` attached to `document.body`.
- Call `attachShadow({ mode: "closed" })` to ensure zero style leakage to or from host page.
- Inject isolated scoped CSS:
  ```css
  .rahi-badge {
    position: absolute;
    background: #2563eb;
    color: #ffffff;
    font-size: 11px;
    font-family: monospace;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 3px;
    z-index: 2147483647;
    pointer-events: none;
    box-shadow: 0 1px 3px rgba(0,0,0,0.4);
  }
  .rahi-badge.pulse { animation: rahi-pulse 1s infinite alternate; }
  ```

**Step 2: Coordinate Bounding Box Positioning**
- Loop through scanned elements; calculate `getBoundingClientRect()`.
- Add `window.scrollX` / `window.scrollY`.
- Position badge at top-left corner of each element.
- Bind `window.addEventListener('resize')` and debounced scroll listeners to refresh badge positions.

**Step 3: Overlay Clear & Destroy Handler**
- On task completion, cancel, or tab blur, cleanly remove `#rahi-badge-root`.

---

### Task 3.3: "Find It for Me" Query Flow
**Objective:** Allow users to ask natural language navigation queries (e.g., "Where is the submit button?") and pulse-highlight the matching element without acting.

**Files:**
- Create: `sidepanel/components/find_it.js`
- Modify: `background/service_worker.js`
- Modify: `content/badge_overlay.js`

**Step 1: Find-Only Query Prompting**
- When user enters query:
- Request fresh action map from content script.
- Prompt Gemini with action map + user query asking for target ID only:
  ```json
  { "target_id": 7, "reason": "Upload resume button located in the application section" }
  ```

**Step 2: Pulse Highlight & Auto-Scroll**
- Content script receives `target_id`.
- Retrieve DOM element: `const target = window.__rahiScannedElements[target_id - 1]`.
- Call `target.scrollIntoView({ behavior: "smooth", block: "center" })`.
- Apply pulsating high-visibility gold border/shadow to badge `#7` and the DOM element for 4 seconds.
- Side panel reports: *"Found it: Element #7 ('Upload Resume') highlighted on page."*

---

### Task 3.4: Strict Action Decision Schema Validator
**Objective:** Enforce deterministic schema validation on every proposed model action before UI rendering.

**Files:**
- Create: `lib/schema_validator.js`
- Modify: `background/service_worker.js`

**Step 1: Strict JSON Schema Validator**
- Implement zero-dependency schema validation for:
  ```json
  {
    "action": "click | type | select | scroll | done | ask_user",
    "target_id": 1,
    "value": "string (optional)",
    "reason": "non-empty string",
    "is_consequential": true | false
  }
  ```
- Reject malformed payloads, NaN targets, or unknown action types.
- Sanitize string values to prevent injection.

---

### Task 3.5: Side Panel Action Approval Card & Execution Controls
**Objective:** Render the human-in-the-loop approval card in the side panel with Approve, Skip, Stop, and Dry Run controls.

**Files:**
- Create: `sidepanel/components/approval.js`
- Modify: `sidepanel/sidepanel.html`
- Modify: `sidepanel/sidepanel.css`

**Step 1: Action Approval Card UI**
- Display prominent step number (e.g. `Step 2 of 15`).
- Target element badge with ID and type (`[#4] Button: "Submit Application"`).
- Proposed value preview if typing.
- Clear 1-sentence rationale in selected language (English / Hinglish).
- Warning banner if `is_consequential: true` (e.g., *"⚠️ Consequential Action: Submits Form"*).

**Step 2: Control Button Actions**
- **Approve:** Proceeds with DOM execution.
- **Dry Run:** Flashes outline on page element without clicking/typing.
- **Skip:** Prompts model with skip feedback to propose an alternative step.
- **Stop:** Immediately cancels the entire task, removes badges, and resets state to Idle.

---

### Task 3.6: Deterministic Synthetic Event Executor
**Objective:** Safely and reliably dispatch DOM events (`click`, `type`, `select`, `scroll`) mimicking human interaction.

**Files:**
- Create: `content/executor.js`
- Modify: `content/content.js`

**Step 1: Human-Like Typing Simulation**
- For `type` action:
- Focus element: `el.focus()`.
- Clear if requested, then dispatch sequence:
  - `new KeyboardEvent('keydown', { key: char, bubbles: true })`
  - Set `el.value = currentValue + char`
  - `new InputEvent('input', { data: char, inputType: 'insertText', bubbles: true })`
  - `new KeyboardEvent('keyup', { key: char, bubbles: true })`
- Dispatch `new Event('change', { bubbles: true })` on blur.

**Step 2: Click & Select Dispatchers**
- For `click`: `el.scrollIntoView({ block: 'center' })` → `el.click()`.
- For `select`: Set `el.value = targetValue` → dispatch `new Event('change', { bubbles: true })`.
- For `scroll`: `window.scrollBy({ top: 400, behavior: 'smooth' })`.

**Step 3: DOM Mutation Verification**
- Observe DOM changes via `MutationObserver` for 500ms post-action to confirm page responsiveness before taking next step snapshot.

---

### Task 3.7: One-Step Agent Loop State Machine & Worker Sleep Hydration
**Objective:** Implement the closed agent loop with automatic state snapshot persistence to survive Chrome MV3 service worker termination.

**Files:**
- Modify: `background/service_worker.js`
- Modify: `sidepanel/components/approval.js`

**Step 1: State Machine Definition**
- States: `Idle` → `Scanning` → `PromptingAI` → `AwaitingApproval` → `Executing` → `Verifying` → `Completed`.
- Max step limit enforced (default 15 steps; aborts if exceeded).

**Step 2: Snapshot Persistence in `chrome.storage.local`**
- After every step transition, write state to `activeTaskState`:
  ```javascript
  chrome.storage.local.set({
    activeTaskState: { taskId, tabId, goal, currentStep, status, pendingAction, historyLog }
  });
  ```
- On service worker wake (`chrome.runtime.onStartup`, message arrival), rehydrate state from storage.

**Step 3: Action Log Drawer**
- Persist chronological task history in side panel:
  `Step 1: Type "Rehan Sheikh" into #1 (Approved)`
  `Step 2: Select "B.Tech" in #3 (Approved)`
  `Step 3: Click #4 "Submit" (Consequential - Approved)`
- Provide "Export Log as JSON" option.

---

## Phase 4: Week 4 — Memory, Safety, and Shipping

### Task 4.1: Local User Profile Memory
**Objective:** Provide an in-browser personal profile editor that Rahi leverages for auto-populating form fields and drafting replies.

**Files:**
- Create: `sidepanel/components/profile.js`
- Modify: `sidepanel/sidepanel.html`
- Modify: `background/service_worker.js`

**Step 1: Profile Schema & Editor View**
- Store under `chrome.storage.local.userProfile`:
  - `fullName`, `email`, `phone`, `college`, `degree`, `skills` (array), `links` (GitHub, LinkedIn, portfolio), `preferredTone`.
- Build clean tabular editor in Side Panel "Profile" tab with inline validation.

**Step 2: Profile Injection into Agent Form Tasks**
- When executing form-filling instructions, inject sanitized profile JSON into the model context:
  `[USER PROFILE CONTEXT] ... [END PROFILE]`
- Instruct model to map profile values to appropriate field labels (e.g. matching "College Email" to `userProfile.email`).

---

### Task 4.2: One-Click Skills Hub with Import/Export (`rahi-skills-v1`)
**Objective:** Allow users to run, create, export, and import reusable prompt recipes.

**Files:**
- Create: `sidepanel/components/skills.js`
- Modify: `sidepanel/sidepanel.html`

**Step 1: Built-in Default Skills**
- Pre-populate 4 standard skills:
  1. *Exam Notes:* Summarize page into high-yield exam bullet points.
  2. *Explain in Hinglish:* Break down active page content in simple Hinglish.
  3. *Draft Polite Reply:* Formulate polite response to selected text.
  4. *Fill Form from Profile:* Auto-map form fields using stored profile.

**Step 2: Custom Skill Creator**
- Allow users to add custom skills with: `name`, `description`, `promptTemplate`, `outputType` (`summary` | `chat` | `action`).

**Step 3: Secure Export & Import Engine**
- Export: Downloads `rahi-skills.json` envelope with `format: "rahi-skills-v1"`.
- Import: Validates format, field completeness, file size (<50 KB), and sanitizes against script injection (`<script>`, `eval(`, etc.).

---

### Task 4.3: Hardcoded Security Guardrails (Defense in Depth)
**Objective:** Implement deterministic client-side safety interceptors that unconditionally block unsafe domains and sensitive fields.

**Files:**
- Create: `content/safety_guard.js`
- Modify: `content/executor.js`
- Modify: `background/service_worker.js`

**Step 1: Domain Firewall (Layer 1)**
- Blacklist patterns: `bank`, `pay`, `upi`, `checkout`, `netbanking`, `payment`, `accounts.google.com/signin`, etc.
- If current tab matches, reject agent task with explicit notice: *"Rahi actions are disabled on financial and authentication pages for your security."*

**Step 2: Element Sentinel (Layer 2)**
- Intercept element interaction in `content/safety_guard.js`:
  - `input[type="password"]`
  - `input[autocomplete*="one-time-code"]`, `input[name*="otp" i]`, `input[id*="otp" i]`
  - `input[autocomplete*="cc-"]`, `input[name*="card" i]`, `input[id*="cvv" i]`
- Refuse execution unconditionally, even if requested by model output.

**Step 3: Consequential Confirmation Modal (Layer 3)**
- Detect triggers: `submit`, `delete`, `pay`, `transfer`, `remove`, `buy`.
- If `is_consequential: true`, render high-priority red warning dialog in side panel requiring explicit secondary checkbox: *"I understand this action will submit data or make changes."*

---

### Task 4.4: Controlled Practice Errand Environments & Test Suite
**Objective:** Build local mock test HTML pages to reliably test and demonstrate the agent loop end-to-end.

**Files:**
- Create: `test/fixtures/mock_internship_form.html`
- Create: `test/fixtures/mock_product_catalog.html`
- Create: `test/fixtures/mock_article.html`

**Step 1: Mock Practice Pages**
- `mock_internship_form.html`: Multi-step form with text inputs, degree dropdown, checkboxes, and submit button.
- `mock_product_catalog.html`: Filterable product grid with category checkboxes, price range, and search bar.
- `mock_article.html`: Realistic blog post with ads, sidebar noise, and core article text for Readability verification.

**Step 2: End-to-End Manual & Automated Verification Scripts**
- Verify: Form fill completes in under 6 steps with 100% human approval checkpoints.
- Verify: Password/sensitive field blocks fire reliably on injection attempts.

---

### Task 4.5: Distribution, Documentation & Landing Site
**Objective:** Package Rahi for public GitHub release and deploy a clean project landing page.

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Create: `landing/index.html`
- Create: `landing/style.css`

**Step 1: Clean Repository Configuration**
- Write `.gitignore` excluding `.env`, `node_modules`, `*.pem`, `*.crx`, OS store files.
- Ensure zero API keys or personal credentials exist in source.

**Step 2: Comprehensive README.md**
- Document: Overview, Architecture diagrams, Installation via Chrome "Load unpacked", Gemini/Groq setup instructions, feature walk-throughs, privacy guarantees.

**Step 3: GitHub Pages Showcase Landing Site**
- Modern, clean static site (`landing/index.html`):
  - Product hero with screenshot/mockup.
  - Core feature highlights (Eyes, Brain, Hands, Safety).
  - Step-by-step setup guide.
  - Link to GitHub repository & latest Release ZIP.

---

## Traceability & Coverage Matrix

| Feature Requirement | Architecture Section | Implementation Plan Task |
|:---|:---|:---|
| **FR-1: Side Panel UI** | Section 3.1, ADR-001 | Task 1.1 |
| **FR-2: Settings & API Keys** | Section 3.1, 6 | Task 1.1, 2.4 |
| **FR-3: Content Extraction** | Section 3.3, 4.1 | Task 1.3 |
| **FR-4: Summarisation & Hinglish** | Section 4.1, 4.2 | Task 1.2, 1.3, 1.4 |
| **FR-5: Grounded Page Chat** | Section 4.4, ADR-005 | Task 2.1 |
| **FR-6: Screenshot & Visual Query** | Section 4.3, ADR-006 | Task 2.3 |
| **FR-7: Structured Agent Decisions** | Section 4.7, 4.8 | Task 3.1, 3.4 |
| **FR-8: Human Approval Loop** | Section 1, 4.6 | Task 3.5, 3.7 |
| **FR-9: Local Profile & Memory** | Section 6 | Task 4.1, 4.2 |
| **FR-10: Deterministic Safety** | Section 5, ADR-003 | Task 4.3 |
