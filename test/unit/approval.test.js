/**
 * Rahi - Action Approval Controller Unit Tests
 * Validates agent prompt assembly, profile memory injection,
 * and state transitions.
 */

import assert from 'node:assert';
import { AgentApprovalController } from '../../sidepanel/components/approval.js';

console.log('Testing Agent Approval Controller & Planning Engine...');

// Test 1: Agent Reasoning Prompt Assembly
{
  const controller = new AgentApprovalController({});

  const goal = 'Search for summer internship';
  const manifest = [
    { id: 1, type: 'input_text', label: 'Search Query', placeholder: 'Search...' },
    { id: 2, type: 'button', label: 'Submit Search' }
  ];
  const history = [
    { step: 1, action: { type: 'type', targetId: 1, value: 'internship' }, outcome: 'Success' }
  ];
  const userProfile = {
    fullName: 'Rehan Sheikh',
    skills: ['JavaScript', 'Python'],
    college: 'Masai'
  };

  const { prompt, systemInstruction } = controller.buildAgentPrompt({
    goal,
    step: 2,
    maxSteps: 15,
    manifest,
    history,
    previousFeedback: 'Avoid sponsored links',
    userProfile,
    language: 'en'
  });

  assert.ok(prompt.includes('User Goal: "Search for summer internship"'));
  assert.ok(prompt.includes('Current Step: 2 of 15'));
  assert.ok(prompt.includes('Rehan Sheikh'));
  assert.ok(prompt.includes('Masai'));
  assert.ok(prompt.includes('[#1] input_text "Search Query"'));
  assert.ok(prompt.includes('Avoid sponsored links'));
  assert.ok(systemInstruction.includes('Maximum step limit is 15'));
  console.log('✅ Test 1: Agent multi-turn prompt assembly verified');
}

// Test 2: Status Panel & Log Rendering
{
  const mockPanel = { innerHTML: '' };
  const mockList = {
    children: [],
    prepend: (item) => mockList.children.unshift(item),
    querySelector: () => null
  };

  const controller = new AgentApprovalController({
    elements: {
      agentStatusPanel: mockPanel,
      agentLogList: mockList
    }
  });

  controller.setStatus('Thinking...', 'busy');
  assert.ok(mockPanel.innerHTML.includes('Thinking...'));
  assert.ok(mockPanel.innerHTML.includes('status-busy'));

  controller.appendLog('Clicked button #1', 'success');
  assert.strictEqual(mockList.children.length, 1);
  assert.ok(mockList.children[0].className.includes('log-success'));

  console.log('✅ Test 2: Status indicators and action logging verified');
}

console.log('All approval controller unit tests passed successfully!');
