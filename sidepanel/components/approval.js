/**
 * Rahi - Action Approval Card & Agent State Controller
 * Manages the human-in-the-loop action execution cycle, dry run previews,
 * consequential action safety gates, and multi-step task progression.
 */

import { callAIWithFailover } from '../../background/ai_gateway.js';
import { validateActionDecision, extractActionJSON } from '../../lib/schema_validator.js';
import { checkDomainFirewall } from '../../lib/safety_guard.js';
import { findAndHighlightElement } from './find_it.js';

export class AgentApprovalController {
  constructor(options = {}) {
    this.elements = options.elements || {};
    this.getSettings = options.getSettings || (() => ({}));
    this.getUserProfile = options.getUserProfile || (() => null);
    this.getActiveTab = options.getActiveTab || (() => null);

    // State
    this.isRunning = false;
    this.currentStep = 0;
    this.maxStepLimit = 15;
    this.currentGoal = '';
    this.currentManifest = [];
    this.currentDecision = null;
    this.actionHistory = [];

    this.initEventListeners();
  }

  initEventListeners() {
    // Start Agent Task
    if (this.elements.btnStartAgent) {
      this.elements.btnStartAgent.addEventListener('click', () => {
        const goal = this.elements.agentGoalInput?.value?.trim();
        if (!goal) {
          alert('Please enter a task goal for Rahi (e.g. "Find the submit button" or "Fill job application form").');
          return;
        }
        this.startTask(goal);
      });
    }

    if (this.elements.agentGoalInput) {
      this.elements.agentGoalInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.elements.btnStartAgent?.click();
        }
      });
    }

    // Scan & Number Elements
    if (this.elements.btnScanElements) {
      this.elements.btnScanElements.addEventListener('click', () => this.scanAndDisplayBadges());
    }

    // Clear Badges
    if (this.elements.btnClearBadges) {
      this.elements.btnClearBadges.addEventListener('click', () => this.clearBadgesOnTab());
    }

    // Find It for Me button
    if (this.elements.btnFindElement) {
      this.elements.btnFindElement.addEventListener('click', () => this.handleFindItForMe());
    }

    // Approval Controls
    if (this.elements.chkConsequentialConsent) {
      this.elements.chkConsequentialConsent.addEventListener('change', (e) => {
        if (this.elements.btnApproveAction) {
          this.elements.btnApproveAction.disabled = !e.target.checked;
        }
      });
    }

    if (this.elements.btnApproveAction) {
      this.elements.btnApproveAction.addEventListener('click', () => this.handleApprove());
    }
    if (this.elements.btnDryRunAction) {
      this.elements.btnDryRunAction.addEventListener('click', () => this.handleDryRun());
    }
    if (this.elements.btnSkipAction) {
      this.elements.btnSkipAction.addEventListener('click', () => this.handleSkip());
    }
    if (this.elements.btnStopAction) {
      this.elements.btnStopAction.addEventListener('click', () => this.stopTask('Stopped by user'));
    }

    // Clear Log
    if (this.elements.btnClearLog) {
      this.elements.btnClearLog.addEventListener('click', () => this.clearLog());
    }
  }

  /**
   * Scans active tab and shows numbered badges over all interactive elements
   */
  async scanAndDisplayBadges() {
    const tab = this.getActiveTab();
    if (!tab || !tab.id) {
      this.setStatus('No active web page detected', 'warning');
      return [];
    }

    try {
      this.setStatus('Scanning interactive elements...', 'busy');

      // Check if scripts are already loaded; if not, inject them
      let isLoaded = false;
      try {
        const check = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => typeof window.rahiScanInteractiveElements === 'function' && typeof window.rahiShowBadges === 'function',
        });
        isLoaded = check?.[0]?.result === true;
      } catch (_) {}

      if (!isLoaded) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/scanner.js', 'content/badge_overlay.js', 'content/safety_guard.js', 'content/executor.js'],
          });
        } catch (injErr) {
          console.warn('[Rahi Agent] Injection note:', injErr);
        }
      }

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          if (typeof window.rahiScanInteractiveElements === 'function') {
            const manifest = window.rahiScanInteractiveElements();
            if (typeof window.rahiShowBadges === 'function') {
              window.rahiShowBadges(manifest);
            }
            return manifest;
          }
          return [];
        },
      });

      const manifest = results?.[0]?.result || [];
      this.currentManifest = manifest;

      this.setStatus(`Numbered ${manifest.length} interactive elements on page`, 'online');
      this.appendLog(`Numbered ${manifest.length} elements with badges`, 'info');
      return manifest;
    } catch (err) {
      console.error('[Rahi Agent] Scan error:', err);
      this.setStatus(`Scan failed: ${err.message}`, 'error');
      return [];
    }
  }

  /**
   * Clears badges from active tab
   */
  async clearBadgesOnTab() {
    const tab = this.getActiveTab();
    if (!tab || !tab.id) return;

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          if (typeof window.rahiRemoveBadges === 'function') {
            window.rahiRemoveBadges();
          }
        },
      });
      this.setStatus('Badges cleared from page', 'online');
      this.appendLog('Cleared badges from page', 'info');
    } catch (err) {
      console.warn('[Rahi Agent] Clear badges error:', err);
    }
  }

  /**
   * "Find It for Me" quick trigger
   */
  async handleFindItForMe() {
    const query = prompt('What element are you looking for on this page? (e.g. "Apply Now button", "Pricing table", "Search input")');
    if (!query || !query.trim()) return;

    const tab = this.getActiveTab();
    const settings = this.getSettings();

    if (!tab || !tab.id) {
      alert('No active browser tab found.');
      return;
    }

    if (!settings.geminiApiKey) {
      alert('Please configure your Gemini API key in Settings first.');
      return;
    }

    try {
      this.setStatus(`Locating "${query}"...`, 'busy');
      const result = await findAndHighlightElement({
        tabId: tab.id,
        query,
        apiKey: settings.geminiApiKey,
        groqApiKey: settings.groqApiKey,
        model: settings.defaultModel || 'gemini-3.5-flash-lite',
        language: settings.preferredLanguage || 'en',
      });

      this.setStatus(`Found: ${result.label}`, 'online');
      this.appendLog(`🔍 Located element: ${result.label} — ${result.explanation}`, 'success');
    } catch (err) {
      alert(`Could not locate element: ${err.message}`);
      this.setStatus(`Locate error: ${err.message}`, 'error');
    }
  }

  /**
   * Starts a multi-step task goal
   */
  async startTask(goal) {
    const settings = this.getSettings();
    if (!settings.geminiApiKey) {
      alert('Please enter your Gemini API Key in Settings before starting an agent task.');
      return;
    }

    // Layer 1 Safety Guard: Domain Firewall Check
    const activeTab = this.getActiveTab();
    if (activeTab && activeTab.url) {
      const firewall = checkDomainFirewall(activeTab.url);
      if (!firewall.allowed) {
        this.setStatus('Task Aborted: Financial or Authentication Portal', 'error');
        this.appendLog(`🛡️ Domain Firewall: ${firewall.reason}`, 'error');
        alert(firewall.reason);
        return;
      }
    }

    this.isRunning = true;
    this.currentStep = 0;
    this.maxStepLimit = settings.maxStepLimit || 15;
    this.currentGoal = goal;
    this.actionHistory = [];

    this.setStatus(`Starting goal: "${goal}"`, 'busy');
    this.appendLog(`🚀 Starting goal: "${goal}"`, 'info');

    // Run first step
    await this.stepNextAction();
  }

  /**
   * Plans and requests the next action decision from the model
   */
  async stepNextAction(previousFeedback = '') {
    if (!this.isRunning) return;

    this.currentStep++;

    if (this.currentStep > this.maxStepLimit) {
      this.stopTask(`Maximum step limit reached (${this.maxStepLimit}/${this.maxStepLimit}). Pausing for safety.`);
      return;
    }

    // 1. Scan current page elements
    const manifest = await this.scanAndDisplayBadges();
    if (!manifest || manifest.length === 0) {
      this.stopTask('No interactive elements found on the page to proceed.');
      return;
    }

    this.setStatus(`Reasoning step ${this.currentStep} of ${this.maxStepLimit}...`, 'busy');

    // 2. Build multi-turn action agent prompt
    const settings = this.getSettings();
    const userProfile = this.getUserProfile();

    const { prompt, systemInstruction } = this.buildAgentPrompt({
      goal: this.currentGoal,
      step: this.currentStep,
      maxSteps: this.maxStepLimit,
      manifest,
      history: this.actionHistory,
      previousFeedback,
      userProfile,
      language: settings.preferredLanguage || 'en',
    });

    try {
      const response = await callAIWithFailover({
        geminiApiKey: settings.geminiApiKey,
        groqApiKey: settings.groqApiKey,
        model: settings.defaultModel || 'gemini-3.5-flash-lite',
        prompt,
        systemInstruction,
        language: settings.preferredLanguage || 'en',
        temperature: 0.1,
      });

      const parsedJSON = extractActionJSON(response.text);
      const validation = validateActionDecision(parsedJSON, manifest);

      if (!validation.valid) {
        console.warn('[Rahi Agent] Invalid action schema received:', validation.errors);
        this.appendLog(`⚠️ Model schema issue: ${validation.errors.join('; ')}. Retrying...`, 'warning');
        // Self-heal retry once with explicit error feedback
        return await this.stepNextAction(`Your previous action failed schema validation: ${validation.errors.join(', ')}. Please provide a strictly compliant JSON response.`);
      }

      this.currentDecision = validation.sanitized;

      // Check if model concluded goal is finished
      if (this.currentDecision.action.type === 'finish') {
        this.finishTask(this.currentDecision.action.message || 'Goal reached successfully!');
        return;
      }

      // Check if model needs user clarification
      if (this.currentDecision.action.type === 'ask_user') {
        const question = this.currentDecision.action.question;
        const answer = prompt(`Rahi needs clarification:\n${question}`);
        if (answer) {
          return await this.stepNextAction(`User answered clarification: "${answer}"`);
        } else {
          this.stopTask('Task cancelled during user clarification.');
          return;
        }
      }

      // 3. Highlight target element on host page
      const targetId = this.currentDecision.action.targetId;
      if (targetId) {
        const tab = this.getActiveTab();
        if (tab?.id) {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (id) => {
              if (typeof window.rahiHighlightElement === 'function') {
                window.rahiHighlightElement(id, true);
              }
            },
            args: [targetId],
          }).catch(() => {});
        }
      }

      // 4. Render Action Approval Card
      this.displayApprovalCard(this.currentDecision);

    } catch (err) {
      console.error('[Rahi Agent] Action planning error:', err);
      this.stopTask(`Action error: ${err.message}`);
    }
  }

  /**
   * Displays action details in Side Panel for user approval
   */
  displayApprovalCard(decision) {
    if (!this.elements.actionApprovalCard) return;

    const { action, thought, isConsequential, targetLabel } = decision;

    // Step Badge
    if (this.elements.approvalStepNumber) {
      this.elements.approvalStepNumber.textContent = `Step ${this.currentStep} of ${this.maxStepLimit}`;
    }

    // Consequential Warning Badge & Secondary Consent Checkbox (Layer 3 Safety)
    if (this.elements.approvalConsequentialBadge) {
      if (isConsequential) {
        this.elements.approvalConsequentialBadge.classList.remove('hidden');
        this.elements.actionApprovalCard.classList.add('consequential-alert');
      } else {
        this.elements.approvalConsequentialBadge.classList.add('hidden');
        this.elements.actionApprovalCard.classList.remove('consequential-alert');
      }
    }

    if (this.elements.consequentialConsentBox) {
      if (isConsequential) {
        this.elements.consequentialConsentBox.classList.remove('hidden');
        if (this.elements.chkConsequentialConsent) {
          this.elements.chkConsequentialConsent.checked = false;
        }
        if (this.elements.btnApproveAction) {
          this.elements.btnApproveAction.disabled = true;
        }
      } else {
        this.elements.consequentialConsentBox.classList.add('hidden');
        if (this.elements.btnApproveAction) {
          this.elements.btnApproveAction.disabled = false;
        }
      }
    }

    // Target Preview
    if (this.elements.approvalTargetPreview) {
      if (action.type === 'scroll') {
        this.elements.approvalTargetPreview.textContent = `Action: Scroll ${action.direction} by ${action.amount || 300}px`;
      } else if (action.type === 'type') {
        this.elements.approvalTargetPreview.textContent = `Action: Type "${action.value}" into [#${action.targetId}] ${targetLabel || ''}`;
      } else {
        this.elements.approvalTargetPreview.textContent = `Action: Click [#${action.targetId}] ${targetLabel || ''}`;
      }
    }

    // Reason
    if (this.elements.approvalReason) {
      this.elements.approvalReason.textContent = thought || 'Proceeding with step.';
    }

    // Unhide Card
    this.elements.actionApprovalCard.classList.remove('hidden');
    this.setStatus('Awaiting your approval...', 'warning');
  }

  hideApprovalCard() {
    if (this.elements.actionApprovalCard) {
      this.elements.actionApprovalCard.classList.add('hidden');
      this.elements.actionApprovalCard.classList.remove('consequential-alert');
    }
    if (this.elements.consequentialConsentBox) {
      this.elements.consequentialConsentBox.classList.add('hidden');
    }
    if (this.elements.btnApproveAction) {
      this.elements.btnApproveAction.disabled = false;
    }
  }

  /**
   * User approved action -> Execute synthetic event directly on page
   */
  async handleApprove() {
    if (!this.currentDecision) return;

    const decision = this.currentDecision;
    this.hideApprovalCard();
    this.setStatus(`Executing ${decision.action.type}...`, 'busy');

    const tab = this.getActiveTab();
    if (!tab || !tab.id) {
      this.stopTask('Lost connection to active tab.');
      return;
    }

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (act) => {
          if (typeof window.rahiDispatchBrowserAction === 'function') {
            return await window.rahiDispatchBrowserAction(act);
          }
          return { success: false, error: 'Executor module not available in page' };
        },
        args: [decision.action],
      });

      const execResult = results?.[0]?.result || { success: false, error: 'No execution result returned' };

      if (!execResult.success) {
        if (execResult.blockedBySafety) {
          this.appendLog(`🛡️ [Safety Interceptor]: ${execResult.error}`, 'error');
          this.stopTask(`Safety Block: ${execResult.error}`);
          alert(execResult.error);
          return;
        }

        this.appendLog(`❌ Action failed: ${execResult.error}`, 'error');
        this.actionHistory.push({
          step: this.currentStep,
          action: decision.action,
          outcome: `Failed: ${execResult.error}`,
        });
        // Let model know of failure and try recovery
        await this.stepNextAction(`Action execution failed: ${execResult.error}. Try an alternative approach.`);
        return;
      }

      this.appendLog(`✅ ${execResult.message || `Executed ${decision.action.type}`}`, 'success');
      this.actionHistory.push({
        step: this.currentStep,
        action: decision.action,
        outcome: execResult.message || 'Success',
      });

      // Wait 1.2s for DOM to update or navigate after click/typing
      this.setStatus('Waiting for page response...', 'busy');
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // Advance to next step
      await this.stepNextAction();

    } catch (err) {
      console.error('[Rahi Agent] Execution dispatch error:', err);
      this.stopTask(`Dispatch error: ${err.message}`);
    }
  }

  /**
   * User clicked Dry Run -> Highlight and preview values without mutating page state
   */
  async handleDryRun() {
    if (!this.currentDecision) return;

    const decision = this.currentDecision;
    const tab = this.getActiveTab();

    if (decision.action.targetId && tab?.id) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (id) => {
          if (typeof window.rahiHighlightElement === 'function') {
            window.rahiHighlightElement(id, true);
          }
        },
        args: [decision.action.targetId],
      });
    }

    this.appendLog(`👁️ [Dry Run] Previewed ${decision.action.type} on [#${decision.action.targetId || 'page'}]. No change executed.`, 'info');
    this.setStatus('Dry run previewed. Click Approve to execute or Skip to bypass.', 'online');
  }

  /**
   * User clicked Skip -> Tell model to find an alternative action
   */
  async handleSkip() {
    if (!this.currentDecision) return;

    const decision = this.currentDecision;
    this.hideApprovalCard();

    this.appendLog(`⏭️ Skipped step ${this.currentStep}: ${decision.action.type} on [#${decision.action.targetId}]`, 'warning');
    this.actionHistory.push({
      step: this.currentStep,
      action: decision.action,
      outcome: 'Skipped by user',
    });

    await this.stepNextAction(`User chose to skip the previous suggested action (${decision.action.type}). Please suggest an alternate way to achieve the goal.`);
  }

  /**
   * Stop task
   */
  async stopTask(reason = 'Task stopped') {
    this.isRunning = false;
    this.currentDecision = null;
    this.hideApprovalCard();
    await this.clearBadgesOnTab();
    this.setStatus(reason, 'warning');
    this.appendLog(`🛑 ${reason}`, 'warning');
  }

  /**
   * Goal reached successfully
   */
  async finishTask(message) {
    this.isRunning = false;
    this.currentDecision = null;
    this.hideApprovalCard();
    await this.clearBadgesOnTab();
    this.setStatus('Goal Complete! 🎉', 'online');
    this.appendLog(`🎉 Task Complete: ${message}`, 'success');
  }

  /**
   * Builds the comprehensive action agent reasoning prompt
   */
  buildAgentPrompt({
    goal,
    step,
    maxSteps,
    manifest,
    history,
    previousFeedback,
    userProfile,
    language = 'en',
  }) {
    const elementsList = manifest.slice(0, 120).map((m) => {
      let line = `[#${m.id}] ${m.type} "${m.label || ''}"`;
      if (m.placeholder) line += ` placeholder="${m.placeholder}"`;
      if (m.value !== undefined) line += ` value="${m.value}"`;
      return line;
    }).join('\n');

    const historyText = history.length > 0
      ? history.map((h) => `- Step ${h.step}: ${h.action.type} [#${h.action.targetId || ''}] -> ${h.outcome}`).join('\n')
      : 'None (starting step 1)';

    const profileText = userProfile
      ? `User Profile Memory (for form filling):\n- Name: ${userProfile.fullName || 'N/A'}\n- Email: ${userProfile.email || 'N/A'}\n- Phone: ${userProfile.phone || 'N/A'}\n- College: ${userProfile.college || 'N/A'}\n- Degree: ${userProfile.degree || 'N/A'}\n- Skills: ${(userProfile.skills || []).join(', ') || 'N/A'}`
      : 'No user profile memory saved.';

    const systemInstruction = `You are Rahi, an autonomous, highly reliable, and safety-conscious AI web browser agent.
Your mission is to help the user achieve their stated goal on the active web page step by step.

CRITICAL RULES:
1. Every action must target a valid element ID from the provided numbered list of interactive elements.
2. For text inputs, use action "type" with the exact string "value". Utilize User Profile Memory if filling user details.
3. For buttons and links, use action "click".
4. If the goal is satisfied, use action "finish" with a descriptive message.
5. If you cannot proceed without user input, use action "ask_user".
6. Maximum step limit is ${maxSteps}. Step strictly towards the goal without redundant actions.
7. Return STRICT JSON only matching this schema:
{
  "thought": "Brief reasoning explaining why this action was chosen",
  "action": {
    "type": "click" | "type" | "select" | "scroll" | "finish" | "ask_user",
    "targetId": number (required for click/type/select),
    "value": string (required for type/select),
    "direction": "up" | "down" (required for scroll),
    "amount": number (optional, default 300),
    "message": string (required for finish),
    "question": string (required for ask_user)
  },
  "status": "continue" | "done" | "need_clarification" | "blocked"
}`;

    const prompt = `User Goal: "${goal}"
Current Step: ${step} of ${maxSteps}

${profileText}

Action History so far:
${historyText}
${previousFeedback ? `\nFeedback / Note: ${previousFeedback}\n` : ''}

Numbered Interactive Elements on Current Page:
${elementsList}

What is the next single best action to advance towards the goal?
Respond with STRICT JSON only.`;

    return { prompt, systemInstruction };
  }

  /**
   * Logging and status UI helpers
   */
  setStatus(text, type = 'online') {
    if (!this.elements.agentStatusPanel) return;
    const dot = type === 'busy' ? '🟡' : (type === 'error' ? '🔴' : (type === 'warning' ? '⚠️' : '🟢'));
    this.elements.agentStatusPanel.innerHTML = `
      <div class="status-active status-${type}">
        <span class="status-icon">${dot}</span>
        <span class="status-text">${text}</span>
      </div>
    `;
  }

  appendLog(message, type = 'info') {
    if (!this.elements.agentLogList) return;

    // Clear empty state if present
    const empty = this.elements.agentLogList.querySelector?.('.empty');
    if (empty && typeof empty.remove === 'function') empty.remove();

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    let logItem;
    if (typeof document !== 'undefined' && document.createElement) {
      logItem = document.createElement('div');
      logItem.className = `log-item log-${type}`;
      logItem.innerHTML = `<span class="log-time">${time}</span> <span class="log-msg">${message}</span>`;
    } else {
      logItem = {
        className: `log-item log-${type}`,
        innerHTML: `<span class="log-time">${time}</span> <span class="log-msg">${message}</span>`,
      };
    }

    if (typeof this.elements.agentLogList.prepend === 'function') {
      this.elements.agentLogList.prepend(logItem);
    }
  }

  clearLog() {
    if (!this.elements.agentLogList) return;
    this.elements.agentLogList.innerHTML = '<div class="log-item empty">No actions executed yet.</div>';
  }
}
