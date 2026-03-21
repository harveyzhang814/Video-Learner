#!/bin/bash

# Orchestrator E2E Test Script
# 测试编排层的核心功能

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
NODE_SCRIPT="/tmp/test_orchestrator_$$.js"

echo "=========================================="
echo "Orchestrator E2E Test"
echo "Base Directory: $BASE_DIR"
echo "=========================================="

# 创建 Node.js 测试脚本
cat > "$NODE_SCRIPT" << 'NODEEOF'
const Orchestrator = require('/Users/harveyzhang96/Projects/Video-Learner/electron/src/orchestrator');
const fs = require('fs');
const path = require('path');

const baseDir = '/Users/harveyzhang96/Projects/Video-Learner';
const orchestrator = new Orchestrator(baseDir);

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✓ PASS: ${name}`);
        passed++;
    } catch (e) {
        console.log(`✗ FAIL: ${name}`);
        console.log(`  Error: ${e.message}`);
        failed++;
    }
}

function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error(`${msg}: expected ${expected}, got ${actual}`);
    }
}

function assertTrue(val, msg) {
    if (!val) {
        throw new Error(`${msg}: expected true`);
    }
}

async function asyncTest(name, fn) {
    try {
        await fn();
        console.log(`✓ PASS: ${name}`);
        passed++;
    } catch (e) {
        console.log(`✗ FAIL: ${name}`);
        console.log(`  Error: ${e.message}`);
        failed++;
    }
}

console.log('\n--- Test 1: generateId method ---');
test('generateId should generate consistent ID', () => {
    const url = 'https://www.youtube.com/watch?v=test';
    const id1 = orchestrator.generateId(url);
    const id2 = orchestrator.generateId(url);
    assertEqual(id1, id2, 'IDs should be consistent');
    assertEqual(id1.length, 12, 'ID should be 12 characters');
});

console.log('\n--- Test 2: runStep prerequisites check ---');
test('checkPrerequisites should return error for missing meta.json', () => {
    const fakeId = 'nonexistent123';
    const errors = orchestrator.checkPrerequisites(fakeId, 'video');
    assertTrue(errors.length > 0, 'Should return error');
    assertTrue(errors[0].includes('meta.json'), 'Error should mention meta.json');
});

test('checkPrerequisites should return error for vtt2md without subs', () => {
    // 创建一个临时目录结构
    const testId = 'test_prereq_' + Date.now();
    const testDir = path.join(baseDir, 'work', testId);
    fs.mkdirSync(path.join(testDir, 'transcript'), { recursive: true });

    // 不创建 subs 目录
    const errors = orchestrator.checkPrerequisites(testId, 'vtt2md');
    assertTrue(errors.length > 0, 'Should return error for missing subs');

    // 清理
    fs.rmSync(testDir, { recursive: true, force: true });
});

test('checkPrerequisites should return error for article without transcript', () => {
    const testId = 'test_prereq_' + Date.now();
    const testDir = path.join(baseDir, 'work', testId);
    fs.mkdirSync(path.join(testDir, 'transcript'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'writing'), { recursive: true });

    const errors = orchestrator.checkPrerequisites(testId, 'article');
    assertTrue(errors.length > 0, 'Should return error for missing transcript');

    // 清理
    fs.rmSync(testDir, { recursive: true, force: true });
});

test('checkPrerequisites should return error for summary without article', () => {
    const testId = 'test_prereq_' + Date.now();
    const testDir = path.join(baseDir, 'work', testId);
    fs.mkdirSync(path.join(testDir, 'transcript'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'writing'), { recursive: true });

    // 创建 meta.json
    const meta = { id: testId, url: 'test', ts: new Date().toISOString() };
    fs.writeFileSync(path.join(testDir, 'transcript', 'meta.json'), JSON.stringify(meta));

    const errors = orchestrator.checkPrerequisites(testId, 'summary');
    assertTrue(errors.length > 0, 'Should return error for missing article.md');

    // 清理
    fs.rmSync(testDir, { recursive: true, force: true });
});

console.log('\n--- Test 3: runStep with prerequisites error ---');
asyncTest('runStep should return error for missing prerequisites', async () => {
    const fakeId = 'nonexistent123';
    const result = await orchestrator.runStep(fakeId, 'video');
    assertTrue(!result.success, 'Should fail');
    assertTrue(result.error.includes('meta.json'), 'Error should mention meta.json');
});

console.log('\n--- Test 4: run method creates directories ---');
asyncTest('run method should create necessary directories', async () => {
    const testUrl = 'https://www.youtube.com/watch?v=test_run_' + Date.now();
    const testId = orchestrator.generateId(testUrl);
    const testDir = path.join(baseDir, 'work', testId);

    // 清理可能存在的旧测试数据
    if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
    }

    // 注意: run 方法需要实际的 YouTube URL 才能完整执行
    // 这里只测试目录创建逻辑，不实际下载
    try {
        await orchestrator.run(testUrl, { downloadVideo: false });
    } catch (e) {
        // 预期可能会因为网络等问题失败，但我们想验证目录是否创建
    }

    // 验证目录结构
    assertTrue(fs.existsSync(path.join(testDir, 'media')), 'media directory should exist');
    assertTrue(fs.existsSync(path.join(testDir, 'transcript', 'subs')), 'transcript/subs directory should exist');
    assertTrue(fs.existsSync(path.join(testDir, 'writing')), 'writing directory should exist');

    // 验证 meta.json 创建
    const meta = orchestrator.getMeta(testId);
    assertTrue(meta !== null, 'meta.json should be created');
    assertEqual(meta.id, testId, 'meta.id should match');
    assertEqual(meta.url, testUrl, 'meta.url should match');

    // 清理
    fs.rmSync(testDir, { recursive: true, force: true });
});

console.log('\n--- Test 5: getStatus method ---');
test('getStatus should return null for nonexistent task', () => {
    const status = orchestrator.getStatus('nonexistent123');
    assertEqual(status, null, 'Should return null for nonexistent task');
});

test('getStatus should return status for existing task', async () => {
    const testUrl = 'https://www.youtube.com/watch?v=test_status_' + Date.now();
    const testId = orchestrator.generateId(testUrl);
    const testDir = path.join(baseDir, 'work', testId);

    // 清理可能存在的旧测试数据
    if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
    }

    try {
        await orchestrator.run(testUrl, { downloadVideo: false });
    } catch (e) {
        // ignore
    }

    const status = orchestrator.getStatus(testId);
    assertTrue(status !== null, 'Should return status object');
    assertEqual(status.id, testId, 'Status id should match');
    assertEqual(status.url, testUrl, 'Status url should match');

    // 清理
    fs.rmSync(testDir, { recursive: true, force: true });
});

console.log('\n--- Test 6: skipStep method ---');
test('skipStep should skip a step', async () => {
    const testUrl = 'https://www.youtube.com/watch?v=test_skip_' + Date.now();
    const testId = orchestrator.generateId(testUrl);
    const testDir = path.join(baseDir, 'work', testId);

    // 清理可能存在的旧测试数据
    if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
    }

    // 先创建任务
    try {
        await orchestrator.run(testUrl, { downloadVideo: false });
    } catch (e) {
        // ignore
    }

    // 跳过 video 步骤
    const result = orchestrator.skipStep(testId, 'video');
    assertTrue(result.success, 'skipStep should succeed');

    // 验证状态
    const status = orchestrator.getStatus(testId);
    assertTrue(status.steps.video, 'video step should exist');
    assertEqual(status.steps.video.status, 'skipped', 'video step should be skipped');

    // 清理
    fs.rmSync(testDir, { recursive: true, force: true });
});

console.log('\n==========================================');
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log('==========================================');

process.exit(failed > 0 ? 1 : 0);
NODEEOF

# 执行 Node.js 测试脚本
node "$NODE_SCRIPT"
TEST_RESULT=$?

# 清理临时文件
rm -f "$NODE_SCRIPT"

# 返回测试结果
if [ $TEST_RESULT -eq 0 ]; then
    echo ""
    echo "All tests passed!"
else
    echo ""
    echo "Some tests failed!"
fi

exit $TEST_RESULT
