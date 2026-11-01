/**
 * Unit tests for Rahi Agent Trace Exporter
 */

import assert from 'node:assert/strict';
import { generateTraceReportHTML } from '../../sidepanel/components/trace_exporter.js';

console.log('Testing Agent Trace HTML Exporter...');

// Test 1: Complete task HTML report generation
{
  const mockTask = {
    id: 'task_12345',
    goal: 'Fill Internship Application & Submit',
    status: 'completed',
    message: 'Application form successfully filled and submitted.',
    stepsCount: 3,
    timestamp: 1729500000000,
    pageUrl: 'https://example.com/apply',
    pageTitle: 'Job Application Portal',
    history: [
      {
        step: 1,
        action: { type: 'type', targetId: 2, value: 'Rehan Sheikh' },
        thought: 'Entering full name into candidate name input field.',
        outcome: 'Typed "Rehan Sheikh" into [#2]',
        targetLabel: 'Full Name Input',
      },
      {
        step: 2,
        action: { type: 'type', targetId: 3, value: 'rehan@example.com' },
        thought: 'Entering contact email.',
        outcome: 'Typed "rehan@example.com" into [#3]',
        targetLabel: 'Email Input',
      },
      {
        step: 3,
        action: { type: 'click', targetId: 5 },
        thought: 'Clicking submit button to finalize submission.',
        outcome: 'Clicked element [button]',
        targetLabel: 'Submit Application Button',
      },
    ],
  };

  const html = generateTraceReportHTML(mockTask);

  assert.ok(html.includes('<!DOCTYPE html>'), 'Generated document must have standard HTML5 DOCTYPE');
  assert.ok(html.includes('Fill Internship Application &amp; Submit'), 'Task goal must be HTML escaped');
  assert.ok(html.includes('Job Application Portal'), 'Page title must be present');
  assert.ok(html.includes('Rehan Sheikh'), 'Typed value must be present');
  assert.ok(html.includes('Entering full name into candidate name input field.'), 'Agent reasoning must be included');
  assert.ok(html.includes('Step 1'), 'Step badge must be rendered');
  assert.ok(html.includes('Step 2'), 'Step 2 must be rendered');
  assert.ok(html.includes('Step 3'), 'Step 3 must be rendered');
  assert.ok(html.includes('action-click'), 'Action type classes must be present');
  assert.ok(html.includes('action-type'), 'Action type classes must be present');
  assert.ok(html.includes('Completed'), 'Status label must reflect completed errand');

  console.log('✅ Test 1: Complete task HTML report generation verified');
}

// Test 2: XSS prevention & input sanitization
{
  const maliciousTask = {
    id: 'task_xss',
    goal: '<script>alert("XSS")</script>',
    status: 'stopped',
    message: '<img src=x onerror=alert(1)>',
    stepsCount: 1,
    timestamp: Date.now(),
    pageUrl: 'https://evil.com/?q=<script>',
    pageTitle: '<b onmouseover=alert(1)>Malicious Page</b>',
    history: [
      {
        step: 1,
        action: { type: 'click', targetId: 1 },
        thought: '"><script>alert("hack")</script>',
        outcome: '<svg onload=alert(2)>',
        targetLabel: 'Normal Button',
      },
    ],
  };

  const html = generateTraceReportHTML(maliciousTask);

  assert.ok(!html.includes('<script>alert("XSS")</script>'), 'Unescaped scripts must not appear in HTML');
  assert.ok(html.includes('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'), 'Malicious characters must be escaped');
  assert.ok(!html.includes('<img src=x'), 'Malicious tags must be escaped');
  assert.ok(!html.includes('<svg onload='), 'Malicious event attributes must be escaped');

  console.log('✅ Test 2: XSS prevention & HTML sanitization verified');
}

// Test 3: Empty history and validation edge cases
{
  assert.throws(() => generateTraceReportHTML(null), /Task record is required/, 'Null record should throw error');

  const emptyTask = {
    goal: 'Quick Inspection',
    status: 'completed',
    history: [],
  };

  const html = generateTraceReportHTML(emptyTask);
  assert.ok(html.includes('Quick Inspection'), 'Goal should render with empty history');
  assert.ok(html.includes('No steps recorded for this task.'), 'Fallback step message should render');

  console.log('✅ Test 3: Empty task history edge case handled gracefully');
}

console.log('All trace exporter unit tests passed successfully!\n');
