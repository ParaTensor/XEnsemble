const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getAgentResume, getAgentResumeLevel, isAgentResumable } = require('./agentResume');

test('droid is a CLI-verified L2 resumable agent', () => {
    assert.equal(getAgentResumeLevel('droid'), 'L2');
    assert.equal(isAgentResumable('droid'), true);
    const resume = getAgentResume('droid');
    assert.equal(resume.stateEnv, 'FACTORY_HOME_OVERRIDE');
    assert.deepEqual(resume.resumeArgs, ['--resume']);
});

test('claude-code is an L2 resumable agent', () => {
    assert.equal(getAgentResumeLevel('claude-code'), 'L2');
    const resume = getAgentResume('claude-code');
    assert.equal(resume.stateEnv, 'CLAUDE_CONFIG_DIR');
    assert.deepEqual(resume.resumeArgs, ['--continue']);
});

test('agents without a resume contract default to L0 (not resumable)', () => {
    assert.equal(getAgentResumeLevel('kimi-code'), 'L0');
    assert.equal(isAgentResumable('kimi-code'), false);
    assert.equal(getAgentResumeLevel('unknown-agent-id'), 'L0');
});
