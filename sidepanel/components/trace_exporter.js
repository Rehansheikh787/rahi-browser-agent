/**
 * Rahi - Agent Trace HTML Report Exporter
 * Generates self-contained, beautifully styled, shareable HTML audit reports
 * of completed agent errands (steps, reasoning, DOM actions, outcomes, timestamps).
 * Zero external runtime dependencies; 100% offline capable.
 */

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(ts) {
  if (!ts) return 'N/A';
  try {
    const d = new Date(ts);
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch (_) {
    return String(ts);
  }
}

/**
 * Generates standalone HTML document representing the agent execution trace
 * @param {Object} taskRecord
 * @param {Object} [userProfile]
 * @returns {string} Standalone HTML document
 */
export function generateTraceReportHTML(taskRecord, userProfile = null) {
  if (!taskRecord) {
    throw new Error('Task record is required to generate trace report');
  }

  const {
    id = `task_${Date.now()}`,
    goal = 'Untitled Task',
    status = 'completed',
    message = '',
    stepsCount = 0,
    timestamp = Date.now(),
    pageUrl = '',
    pageTitle = 'Web Page',
    history = [],
  } = taskRecord;

  const isCompleted = status === 'completed';
  const statusColor = isCompleted ? '#10b981' : '#f59e0b';
  const statusLabel = isCompleted ? 'Completed' : 'Stopped / Aborted';

  const stepsHtml = (history || []).map((item, index) => {
    const stepNum = item.step || (index + 1);
    const action = item.action || {};
    const actionType = (action.type || 'action').toUpperCase();
    const thought = item.thought || item.reason || '';
    const outcome = item.outcome || 'Executed successfully';
    const targetLabel = item.targetLabel || (action.targetId ? `Element #${action.targetId}` : 'Document');
    const value = action.value ? `Value: "${escapeHtml(action.value)}"` : '';
    const direction = action.direction ? `Direction: ${action.direction}` : '';
    const extraDetails = [value, direction].filter(Boolean).join(' | ');

    return `
      <div class="trace-step-card">
        <div class="step-card-header">
          <div class="step-badge-group">
            <span class="step-number">Step ${stepNum}</span>
            <span class="action-type-pill action-${escapeHtml(action.type || 'click')}">${escapeHtml(actionType)}</span>
          </div>
          <span class="step-target">${escapeHtml(targetLabel)}</span>
        </div>
        
        ${thought ? `
        <div class="step-thought-box">
          <span class="box-label">🧠 Agent Reasoning</span>
          <p>${escapeHtml(thought)}</p>
        </div>` : ''}

        <div class="step-details-row">
          ${extraDetails ? `<span class="step-meta"><strong>Params:</strong> ${extraDetails}</span>` : ''}
          <span class="step-outcome"><strong>Outcome:</strong> ${escapeHtml(outcome)}</span>
        </div>
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rahi Agent Trace - ${escapeHtml(goal)}</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f2937;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --primary: #6366f1;
      --primary-gradient: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
      --accent-success: #10b981;
      --accent-warning: #f59e0b;
      --code-bg: #030712;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 32px 16px;
    }

    .container {
      max-width: 860px;
      margin: 0 auto;
    }

    .header-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    }

    .brand-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .brand-title {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -0.02em;
      background: var(--primary-gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 4px 10px;
      border-radius: 9999px;
      background: rgba(16, 185, 129, 0.15);
      color: ${statusColor};
      border: 1px solid ${statusColor}40;
    }

    .goal-title {
      font-size: 22px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 12px;
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      padding-top: 14px;
      border-top: 1px solid var(--card-border);
      font-size: 13px;
      color: var(--text-muted);
    }

    .meta-item strong {
      color: #e5e7eb;
    }

    .stats-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }

    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 16px;
      text-align: center;
    }

    .stat-value {
      font-size: 26px;
      font-weight: 800;
      color: #ffffff;
      font-feature-settings: "tnum";
    }

    .stat-label {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-top: 4px;
    }

    .timeline-title {
      font-size: 16px;
      font-weight: 700;
      color: #e5e7eb;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .timeline-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .trace-step-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 18px;
      transition: border-color 0.2s;
    }

    .trace-step-card:hover {
      border-color: #374151;
    }

    .step-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      flex-wrap: wrap;
      gap: 8px;
    }

    .step-badge-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .step-number {
      font-size: 12px;
      font-weight: 700;
      color: #9ca3af;
      background: #1f2937;
      padding: 2px 8px;
      border-radius: 4px;
    }

    .action-type-pill {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.05em;
      padding: 3px 8px;
      border-radius: 4px;
      background: #374151;
      color: #ffffff;
    }

    .action-click { background: #16a34a; }
    .action-type { background: #0284c7; }
    .action-scroll { background: #8b5cf6; }
    .action-select { background: #d97706; }
    .action-finish { background: #10b981; }

    .step-target {
      font-size: 13px;
      font-weight: 600;
      color: #cbd5e1;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: var(--code-bg);
      padding: 3px 8px;
      border-radius: 4px;
      border: 1px solid #1e293b;
    }

    .step-thought-box {
      background: var(--code-bg);
      border-left: 3px solid var(--primary);
      border-radius: 0 6px 6px 0;
      padding: 12px 14px;
      margin-bottom: 12px;
    }

    .box-label {
      display: block;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      color: #818cf8;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
    }

    .step-thought-box p {
      font-size: 13px;
      color: #e2e8f0;
      line-height: 1.5;
    }

    .step-details-row {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: var(--text-muted);
      border-top: 1px solid #1f2937;
      padding-top: 10px;
      flex-wrap: wrap;
      gap: 8px;
    }

    .step-outcome {
      color: #10b981;
    }

    .footer-note {
      text-align: center;
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid var(--card-border);
    }

    @media print {
      body { background: #ffffff; color: #111827; }
      .header-card, .trace-step-card, .stat-card {
        background: #ffffff;
        border-color: #e5e7eb;
        box-shadow: none;
      }
      .goal-title, .stat-value { color: #111827; }
      .step-thought-box { background: #f9fafb; border-color: #6366f1; color: #111827; }
      .step-thought-box p { color: #1f2937; }
      .step-target { background: #f3f4f6; color: #111827; border-color: #e5e7eb; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-card">
      <div class="brand-row">
        <span class="brand-title">Rahi — AI Web Browser Agent</span>
        <span class="status-badge">${statusLabel}</span>
      </div>
      <h1 class="goal-title">${escapeHtml(goal)}</h1>
      ${message ? `<p style="font-size: 14px; color: var(--text-muted); margin-bottom: 14px;">${escapeHtml(message)}</p>` : ''}
      <div class="meta-grid">
        <div class="meta-item"><strong>Date:</strong> ${formatDate(timestamp)}</div>
        <div class="meta-item"><strong>Page Title:</strong> ${escapeHtml(pageTitle)}</div>
        <div class="meta-item" style="grid-column: 1 / -1; word-break: break-all;"><strong>Page URL:</strong> <a href="${escapeHtml(pageUrl)}" target="_blank" style="color: #818cf8; text-decoration: none;">${escapeHtml(pageUrl)}</a></div>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-value">${stepsCount || (history ? history.length : 0)}</div>
        <div class="stat-label">Total Steps</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${(history || []).filter((h) => h.action?.type === 'click').length}</div>
        <div class="stat-label">Clicks Executed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${(history || []).filter((h) => h.action?.type === 'type').length}</div>
        <div class="stat-label">Fields Filled</div>
      </div>
    </div>

    <div class="timeline-title">
      <span>Execution Audit Timeline (${(history || []).length} steps)</span>
    </div>

    <div class="timeline-list">
      ${stepsHtml || '<div class="trace-step-card"><p style="color: var(--text-muted);">No steps recorded for this task.</p></div>'}
    </div>

    <div class="footer-note">
      Generated automatically by Rahi AI Web Browser Agent • Manifest V3 Autonomous Web Errand Engine
    </div>
  </div>
</body>
</html>`;
}

/**
 * Triggers a direct browser download of the generated HTML report
 * @param {Object} taskRecord
 * @param {Object} [userProfile]
 */
export function downloadTraceReport(taskRecord, userProfile = null) {
  if (typeof document === 'undefined') return;

  const html = generateTraceReportHTML(taskRecord, userProfile);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const safeGoal = (taskRecord.goal || 'task')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .substring(0, 30)
    .replace(/^-+|-+$/g, '');

  const filename = `rahi-trace-${safeGoal || 'errand'}-${Date.now()}.html`;

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
