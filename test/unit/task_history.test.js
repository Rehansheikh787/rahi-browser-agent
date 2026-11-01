/**
 * Unit tests for Rahi Agent Task History & Replay
 */

import assert from 'node:assert/strict';
import { AgentApprovalController } from '../../sidepanel/components/approval.js';

console.log('Testing Agent Task History & Replay Logic...');

// Mock browser chrome storage
const mockStorage = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => {
        if (typeof key === 'string') return { [key]: mockStorage[key] };
        if (Array.isArray(key)) {
          const res = {};
          key.forEach((k) => { res[k] = mockStorage[k]; });
          return res;
        }
        return mockStorage;
      },
      set: async (obj) => {
        Object.assign(mockStorage, obj);
      },
      remove: async (key) => {
        if (typeof key === 'string') delete mockStorage[key];
      },
    },
  },
  tabs: {
    query: async () => [{ id: 101, url: 'https://example.com/apply', title: 'Example Application' }],
    sendMessage: async () => ({ success: true }),
  },
  scripting: {
    executeScript: async () => [{ result: true }],
  },
};

// Test 1: Task recording and persistence
{
  const mockHistoryContainer = { innerHTML: '', appendChild: () => {} };
  const controller = new AgentApprovalController({
    elements: {
      agentHistoryList: mockHistoryContainer,
      agentLogList: { prepend: () => {} },
      agentStatusPanel: { innerHTML: '' },
    },
    getActiveTab: () => ({ id: 101, url: 'https://example.com/apply', title: 'Example Application' }),
  });

  controller.currentGoal = 'Submit Candidate Info';
  controller.currentStep = 3;
  controller.actionHistory = [
    { step: 1, action: { type: 'type', targetId: 2, value: 'Rehan' }, outcome: 'Entered name' },
    { step: 2, action: { type: 'type', targetId: 3, value: 'test@example.com' }, outcome: 'Entered email' },
    { step: 3, action: { type: 'click', targetId: 5 }, outcome: 'Clicked submit' },
  ];

  const record = await controller.saveCurrentTaskToHistory('completed', 'Form submitted successfully');

  assert.ok(record, 'Saved task record must exist');
  assert.equal(record.goal, 'Submit Candidate Info');
  assert.equal(record.status, 'completed');
  assert.equal(record.stepsCount, 3);
  assert.equal(record.history.length, 3);
  assert.equal(record.pageUrl, 'https://example.com/apply');

  // Verify storage persistence
  const saved = mockStorage['agent_task_history'];
  assert.ok(Array.isArray(saved), 'Stored tasks must be an array');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, record.id);

  console.log('✅ Test 1: Task recording and chrome.storage persistence verified');
}

// Test 2: Task list rendering and empty state
{
  let renderedHTML = '';
  const mockHistoryContainer = {
    set innerHTML(val) { renderedHTML = val; },
    get innerHTML() { return renderedHTML; },
    appendChild: (el) => { renderedHTML += el.innerHTML; },
  };

  const controller = new AgentApprovalController({
    elements: { agentHistoryList: mockHistoryContainer },
  });

  controller.renderTaskHistory([]);
  assert.ok(renderedHTML.includes('No previous errands recorded.'), 'Empty state rendered when history is empty');

  // Render 1 task
  const fakeTasks = [
    {
      id: 'task_001',
      goal: 'Order groceries from store',
      status: 'completed',
      stepsCount: 4,
      timestamp: Date.now(),
      pageTitle: 'Grocery Store Online',
      history: [],
    },
  ];

  // Mock document.createElement for node environment
  globalThis.document = {
    createElement: (tag) => {
      const el = {
        className: '',
        innerHTML: '',
        querySelector: () => ({ addEventListener: () => {} }),
      };
      return el;
    },
  };

  controller.renderTaskHistory(fakeTasks);
  assert.ok(renderedHTML.includes('Order groceries from store'), 'Task goal rendered in history card');
  assert.ok(renderedHTML.includes('Replay'), 'Replay button present on task card');
  assert.ok(renderedHTML.includes('Export HTML'), 'Export HTML button present on task card');

  console.log('✅ Test 2: Task list rendering and action triggers verified');
}

// Test 3: Clear task history
{
  mockStorage['agent_task_history'] = [{ id: 'old_task', goal: 'Old Task' }];
  const controller = new AgentApprovalController({
    elements: {
      agentHistoryList: { innerHTML: '' },
      agentStatusPanel: { innerHTML: '' },
    },
  });

  await controller.clearTaskHistory();
  assert.equal(mockStorage['agent_task_history'], undefined, 'Task history must be deleted from storage');
  assert.equal(controller.taskHistory.length, 0, 'In-memory task history must be emptied');

  console.log('✅ Test 3: Clear task history verified');
}

console.log('All Agent Task History unit tests passed successfully!\n');

