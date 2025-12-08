/**
 * Multi-Language Security Tests - Python.
 *
 * Tests that SecurityAgent correctly identifies vulnerabilities
 * in Python code, not just TypeScript.
 *
 * Run with: node --import tsx --test tests/llm/multi-language/python-security.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { SecurityAgent } from '../../../src/agents/analysis/security-agent.js';
import { createCommitTarget } from '../../../src/domain/work-target.js';
import {
  createLLMTestContext,
  createTestRepo,
  addCommit,
  type LLMTestContext,
} from '../helpers/test-context.js';
import {
  assertLLM,
  evaluateLLM,
  formatEvaluationResult,
  getLLMService,
} from '../helpers/llm-assert.js';
import {
  startTestRun,
  logTestResult,
  saveTestRun,
} from '../helpers/result-logger.js';

describe('SecurityAgent Python Analysis', { timeout: 180000 }, () => {
  let ctx: LLMTestContext;

  before(async () => {
    const apiKey = process.env['OPENROUTER_API_KEY'];
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is required for LLM tests');
    }
    const model = getLLMService().getModel();
    console.log(`Using model: ${model}`);
    startTestRun(model);
    ctx = await createLLMTestContext();
  });

  after(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
    await saveTestRun();
  });

  describe('Python SQL Injection', () => {
    it('detects SQL injection in Python f-strings', async () => {
      const repoId = 'llm-python-sql-injection';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Python Database App',
        'requirements.txt': 'psycopg2>=2.9.0\nflask>=2.0.0',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'app/db/queries.py': `
import psycopg2

def get_user_by_email(conn, email: str):
    """VULNERABLE: SQL injection via f-string"""
    cursor = conn.cursor()
    # This is vulnerable to SQL injection
    query = f"SELECT * FROM users WHERE email = '{email}'"
    cursor.execute(query)
    return cursor.fetchone()

def search_products(conn, search_term: str):
    """VULNERABLE: SQL injection via string formatting"""
    cursor = conn.cursor()
    # Also vulnerable - using .format()
    query = "SELECT * FROM products WHERE name LIKE '%{}%'".format(search_term)
    cursor.execute(query)
    return cursor.fetchall()

def get_order(conn, order_id):
    """VULNERABLE: SQL injection via % formatting"""
    cursor = conn.cursor()
    query = "SELECT * FROM orders WHERE id = %s" % order_id
    cursor.execute(query)
    return cursor.fetchone()
`,
      }, 'Add vulnerable Python database queries');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      assert.ok(result.result.findings.length > 0,
        'Should detect SQL injection in Python code');

      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await assertLLM(
        'The security analysis identifies SQL injection vulnerabilities in Python code. ' +
        'It should recognize f-strings, .format(), and % string formatting used in SQL ' +
        'queries as dangerous patterns that allow injection attacks.',
        analysisText,
        7
      );

      logTestResult('Python SQL injection detection', evalResult);
      console.log(formatEvaluationResult('Python SQL injection detection', evalResult));
    });

    it('recognizes safe Python parameterized queries', async () => {
      const repoId = 'llm-python-safe-sql';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Safe Python App',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'app/db/safe_queries.py': `
import psycopg2
from sqlalchemy import text
from sqlalchemy.orm import Session

def get_user_by_email_safe(conn, email: str):
    """SAFE: Using parameterized query with tuple"""
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE email = %s", (email,))
    return cursor.fetchone()

def search_products_safe(conn, search_term: str):
    """SAFE: Using named parameters"""
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM products WHERE name LIKE %(pattern)s",
        {"pattern": f"%{search_term}%"}
    )
    return cursor.fetchall()

def get_user_sqlalchemy(session: Session, user_id: int):
    """SAFE: SQLAlchemy ORM automatically parameterizes"""
    return session.query(User).filter(User.id == user_id).first()

def raw_query_sqlalchemy(session: Session, email: str):
    """SAFE: SQLAlchemy text() with bound parameters"""
    result = session.execute(
        text("SELECT * FROM users WHERE email = :email"),
        {"email": email}
    )
    return result.fetchone()
`,
      }, 'Add safe Python parameterized queries');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis correctly identifies that Python code using parameterized ' +
        'queries with psycopg2 tuple/dict binding, SQLAlchemy ORM, and SQLAlchemy ' +
        'text() with named parameters are SAFE from SQL injection.',
        analysisText,
        8
      );

      logTestResult('Python safe SQL recognition', evalResult);
      console.log(formatEvaluationResult('Python safe SQL recognition', evalResult));
    });
  });

  describe('Python Command Injection', () => {
    it('detects command injection via os.system and subprocess', async () => {
      const repoId = 'llm-python-cmd-injection';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Python CLI Tool',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'app/utils/shell.py': `
import os
import subprocess

def ping_host(hostname: str):
    """VULNERABLE: Command injection via os.system"""
    os.system(f"ping -c 4 {hostname}")

def get_file_info(filename: str):
    """VULNERABLE: Command injection via subprocess with shell=True"""
    result = subprocess.run(
        f"file {filename}",
        shell=True,
        capture_output=True,
        text=True
    )
    return result.stdout

def run_user_command(cmd: str):
    """VULNERABLE: Direct command execution from user input"""
    return os.popen(cmd).read()

def check_dns(domain: str):
    """VULNERABLE: Command injection in subprocess.call"""
    subprocess.call("nslookup " + domain, shell=True)
`,
      }, 'Add vulnerable shell command functions');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      assert.ok(result.result.findings.length > 0,
        'Should detect command injection in Python code');

      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await assertLLM(
        'The security analysis identifies command injection vulnerabilities in Python. ' +
        'It should flag os.system(), subprocess with shell=True, and os.popen() when ' +
        'used with unsanitized user input as dangerous command injection vectors.',
        analysisText,
        7
      );

      logTestResult('Python command injection detection', evalResult);
      console.log(formatEvaluationResult('Python command injection detection', evalResult));
    });
  });

  describe('Python Pickle Deserialization', () => {
    it('detects unsafe pickle deserialization', async () => {
      const repoId = 'llm-python-pickle';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Python Data Processing',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'app/data/loader.py': `
import pickle
import base64

def load_user_data(data_bytes: bytes):
    """VULNERABLE: Deserializing untrusted pickle data"""
    return pickle.loads(data_bytes)

def load_from_file(filepath: str):
    """VULNERABLE: Loading pickle from potentially untrusted source"""
    with open(filepath, 'rb') as f:
        return pickle.load(f)

def decode_and_load(encoded_data: str):
    """VULNERABLE: Pickle from base64-encoded user input"""
    raw_data = base64.b64decode(encoded_data)
    return pickle.loads(raw_data)

def process_request(request):
    """VULNERABLE: Deserializing session data from cookies"""
    session_data = request.cookies.get('session')
    if session_data:
        return pickle.loads(base64.b64decode(session_data))
    return None
`,
      }, 'Add unsafe pickle deserialization');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await assertLLM(
        'The security analysis identifies Python pickle deserialization vulnerabilities. ' +
        'pickle.loads() and pickle.load() with untrusted data can lead to arbitrary ' +
        'code execution. This is a critical security issue in Python applications.',
        analysisText,
        7
      );

      logTestResult('Python pickle vulnerability detection', evalResult);
      console.log(formatEvaluationResult('Python pickle vulnerability detection', evalResult));
    });
  });

  describe('Python Path Traversal', () => {
    it('detects path traversal in file operations', async () => {
      const repoId = 'llm-python-path-traversal';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Python File Server',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'app/files/serve.py': `
import os

UPLOAD_DIR = "/var/uploads"

def read_file(filename: str) -> bytes:
    """VULNERABLE: No path traversal protection"""
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, 'rb') as f:
        return f.read()

def serve_document(doc_path: str) -> bytes:
    """VULNERABLE: Direct path concatenation"""
    full_path = UPLOAD_DIR + "/" + doc_path
    return open(full_path, 'rb').read()

def get_user_file(user_id: str, filename: str) -> bytes:
    """VULNERABLE: Multiple user-controlled path components"""
    path = f"/data/users/{user_id}/files/{filename}"
    return open(path, 'rb').read()
`,
      }, 'Add vulnerable file serving');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await assertLLM(
        'The security analysis identifies path traversal vulnerabilities in Python. ' +
        'Using user input directly in file paths without validation allows attackers ' +
        'to read arbitrary files using "../" sequences.',
        analysisText,
        7
      );

      logTestResult('Python path traversal detection', evalResult);
      console.log(formatEvaluationResult('Python path traversal detection', evalResult));
    });
  });
});
