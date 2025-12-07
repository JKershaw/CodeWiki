/**
 * Multi-Language Security Tests - Go.
 *
 * Tests that SecurityAgent correctly identifies vulnerabilities
 * in Go code, not just TypeScript.
 *
 * Run with: node --import tsx --test tests/llm/multi-language/go-security.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { SecurityAgent } from '../../../src/agents/analysis/security-agent.js';
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

describe('SecurityAgent Go Analysis', { timeout: 180000 }, () => {
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

  describe('Go SQL Injection', () => {
    it('detects SQL injection in Go fmt.Sprintf queries', async () => {
      const repoId = 'llm-go-sql-injection';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Go Database App',
        'go.mod': 'module myapp\n\ngo 1.21',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'db/queries.go': `
package db

import (
    "database/sql"
    "fmt"
)

// VULNERABLE: SQL injection via fmt.Sprintf
func GetUserByEmail(db *sql.DB, email string) (*User, error) {
    query := fmt.Sprintf("SELECT id, name, email FROM users WHERE email = '%s'", email)
    row := db.QueryRow(query)

    var user User
    err := row.Scan(&user.ID, &user.Name, &user.Email)
    return &user, err
}

// VULNERABLE: String concatenation in SQL
func SearchProducts(db *sql.DB, searchTerm string) ([]Product, error) {
    query := "SELECT * FROM products WHERE name LIKE '%" + searchTerm + "%'"
    rows, err := db.Query(query)
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var products []Product
    for rows.Next() {
        var p Product
        rows.Scan(&p.ID, &p.Name)
        products = append(products, p)
    }
    return products, nil
}

// VULNERABLE: User input in ORDER BY clause
func GetSortedUsers(db *sql.DB, sortField string) ([]User, error) {
    query := fmt.Sprintf("SELECT * FROM users ORDER BY %s", sortField)
    rows, err := db.Query(query)
    // ... handling
    return nil, err
}
`,
      }, 'Add vulnerable Go database queries');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnCommit(commitSha, agentCtx);

      assert.ok(result.result.findings.length > 0,
        'Should detect SQL injection in Go code');

      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await assertLLM(
        'The security analysis identifies SQL injection vulnerabilities in Go code. ' +
        'It should recognize fmt.Sprintf and string concatenation used in SQL queries ' +
        'as dangerous patterns that allow SQL injection attacks.',
        analysisText,
        7
      );

      logTestResult('Go SQL injection detection', evalResult);
      console.log(formatEvaluationResult('Go SQL injection detection', evalResult));
    });

    it('recognizes safe Go parameterized queries', async () => {
      const repoId = 'llm-go-safe-sql';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Safe Go App',
        'go.mod': 'module myapp\n\ngo 1.21',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'db/safe_queries.go': `
package db

import (
    "database/sql"
)

// SAFE: Using parameterized queries with ? placeholders
func GetUserByEmailSafe(db *sql.DB, email string) (*User, error) {
    query := "SELECT id, name, email FROM users WHERE email = ?"
    row := db.QueryRow(query, email)

    var user User
    err := row.Scan(&user.ID, &user.Name, &user.Email)
    return &user, err
}

// SAFE: Using $1, $2 placeholders (PostgreSQL style)
func GetUserByIDPostgres(db *sql.DB, id int) (*User, error) {
    row := db.QueryRow("SELECT id, name, email FROM users WHERE id = $1", id)
    var user User
    err := row.Scan(&user.ID, &user.Name, &user.Email)
    return &user, err
}

// SAFE: Multiple parameters properly bound
func SearchProductsInCategory(db *sql.DB, category string, minPrice float64) ([]Product, error) {
    query := "SELECT * FROM products WHERE category = ? AND price >= ?"
    rows, err := db.Query(query, category, minPrice)
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var products []Product
    for rows.Next() {
        var p Product
        rows.Scan(&p.ID, &p.Name, &p.Price)
        products = append(products, p)
    }
    return products, nil
}

// SAFE: Using prepared statements
func CreateUser(db *sql.DB, name, email string) error {
    stmt, err := db.Prepare("INSERT INTO users (name, email) VALUES (?, ?)")
    if err != nil {
        return err
    }
    defer stmt.Close()

    _, err = stmt.Exec(name, email)
    return err
}
`,
      }, 'Add safe Go parameterized queries');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnCommit(commitSha, agentCtx);

      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis correctly identifies that Go code using parameterized queries ' +
        'with ? or $N placeholders and db.Query/db.QueryRow/db.Prepare is SAFE from ' +
        'SQL injection. These use proper parameter binding.',
        analysisText,
        8
      );

      logTestResult('Go safe SQL recognition', evalResult);
      console.log(formatEvaluationResult('Go safe SQL recognition', evalResult));
    });
  });

  describe('Go Command Injection', () => {
    it('detects command injection via os/exec', async () => {
      const repoId = 'llm-go-cmd-injection';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Go CLI Tool',
        'go.mod': 'module myapp\n\ngo 1.21',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'utils/shell.go': `
package utils

import (
    "os/exec"
)

// VULNERABLE: Command injection via shell execution
func PingHost(hostname string) (string, error) {
    // Using /bin/sh -c allows shell metacharacter injection
    cmd := exec.Command("/bin/sh", "-c", "ping -c 4 "+hostname)
    output, err := cmd.Output()
    return string(output), err
}

// VULNERABLE: User input directly in command
func GetFileInfo(filename string) (string, error) {
    cmd := exec.Command("bash", "-c", "file "+filename)
    output, err := cmd.Output()
    return string(output), err
}

// VULNERABLE: Building command string with user input
func RunCustomCommand(userCmd string) (string, error) {
    cmd := exec.Command("sh", "-c", userCmd)
    output, err := cmd.CombinedOutput()
    return string(output), err
}

// VULNERABLE: Multiple arguments from user
func ProcessFiles(files []string) error {
    args := append([]string{"-c", "rm "}, files...)
    cmd := exec.Command("sh", args...)
    return cmd.Run()
}
`,
      }, 'Add vulnerable shell command functions');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnCommit(commitSha, agentCtx);

      assert.ok(result.result.findings.length > 0,
        'Should detect command injection in Go code');

      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await assertLLM(
        'The security analysis identifies command injection vulnerabilities in Go. ' +
        'Using exec.Command with "sh -c" or "bash -c" and concatenating user input ' +
        'allows shell metacharacter injection attacks.',
        analysisText,
        7
      );

      logTestResult('Go command injection detection', evalResult);
      console.log(formatEvaluationResult('Go command injection detection', evalResult));
    });

    it('recognizes safe Go command execution', async () => {
      const repoId = 'llm-go-safe-cmd';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Safe Go CLI',
        'go.mod': 'module myapp\n\ngo 1.21',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'utils/safe_shell.go': `
package utils

import (
    "os/exec"
    "regexp"
)

// SAFE: Direct command execution without shell
func PingHostSafe(hostname string) (string, error) {
    // Validate hostname format first
    if !isValidHostname(hostname) {
        return "", fmt.Errorf("invalid hostname")
    }

    // Execute ping directly, not through shell
    cmd := exec.Command("ping", "-c", "4", hostname)
    output, err := cmd.Output()
    return string(output), err
}

// SAFE: Arguments passed separately, no shell
func GetFileInfoSafe(filename string) (string, error) {
    cmd := exec.Command("file", filename)
    output, err := cmd.Output()
    return string(output), err
}

// SAFE: Using exec.LookPath and separate args
func RunGitCommand(repoPath string, args ...string) (string, error) {
    gitPath, err := exec.LookPath("git")
    if err != nil {
        return "", err
    }

    cmd := exec.Command(gitPath, args...)
    cmd.Dir = repoPath
    output, err := cmd.Output()
    return string(output), err
}

func isValidHostname(h string) bool {
    pattern := regexp.MustCompile("^[a-zA-Z0-9][-a-zA-Z0-9]*(\\\.[a-zA-Z0-9][-a-zA-Z0-9]*)*$")
    return pattern.MatchString(h)
}
`,
      }, 'Add safe Go command execution');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnCommit(commitSha, agentCtx);

      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis correctly identifies that Go code using exec.Command with ' +
        'separate arguments (not shell strings) is SAFE from command injection. ' +
        'This pattern does not invoke a shell and treats arguments literally.',
        analysisText,
        8
      );

      logTestResult('Go safe command recognition', evalResult);
      console.log(formatEvaluationResult('Go safe command recognition', evalResult));
    });
  });

  describe('Go Path Traversal', () => {
    it('detects path traversal in file serving', async () => {
      const repoId = 'llm-go-path-traversal';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Go File Server',
        'go.mod': 'module myapp\n\ngo 1.21',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'handlers/files.go': `
package handlers

import (
    "io"
    "net/http"
    "os"
    "path/filepath"
)

const uploadDir = "/var/uploads"

// VULNERABLE: No path traversal protection
func ServeFile(w http.ResponseWriter, r *http.Request) {
    filename := r.URL.Query().Get("file")
    filePath := filepath.Join(uploadDir, filename)

    data, err := os.ReadFile(filePath)
    if err != nil {
        http.Error(w, "File not found", 404)
        return
    }

    w.Write(data)
}

// VULNERABLE: Using user-provided path directly
func DownloadHandler(w http.ResponseWriter, r *http.Request) {
    path := r.FormValue("path")

    file, err := os.Open(uploadDir + "/" + path)
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    defer file.Close()

    io.Copy(w, file)
}

// VULNERABLE: Multiple user-controlled components
func UserFileHandler(w http.ResponseWriter, r *http.Request) {
    userID := r.URL.Query().Get("user")
    filename := r.URL.Query().Get("file")

    path := fmt.Sprintf("/data/users/%s/files/%s", userID, filename)
    http.ServeFile(w, r, path)
}
`,
      }, 'Add vulnerable file serving handlers');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnCommit(commitSha, agentCtx);

      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await assertLLM(
        'The security analysis identifies path traversal vulnerabilities in Go. ' +
        'Using user input in file paths without validation (even with filepath.Join) ' +
        'allows attackers to access files outside the intended directory.',
        analysisText,
        7
      );

      logTestResult('Go path traversal detection', evalResult);
      console.log(formatEvaluationResult('Go path traversal detection', evalResult));
    });
  });

  describe('Go SSRF', () => {
    it('detects SSRF in HTTP requests', async () => {
      const repoId = 'llm-go-ssrf';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Go Proxy App',
        'go.mod': 'module myapp\n\ngo 1.21',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'handlers/proxy.go': `
package handlers

import (
    "io"
    "net/http"
)

// VULNERABLE: SSRF - fetching user-provided URL
func FetchURL(w http.ResponseWriter, r *http.Request) {
    targetURL := r.URL.Query().Get("url")

    resp, err := http.Get(targetURL)
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    defer resp.Body.Close()

    io.Copy(w, resp.Body)
}

// VULNERABLE: Webhook to user-provided endpoint
func SendWebhook(w http.ResponseWriter, r *http.Request) {
    webhookURL := r.FormValue("webhook_url")
    payload := r.FormValue("data")

    resp, err := http.Post(webhookURL, "application/json", strings.NewReader(payload))
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    resp.Body.Close()

    w.Write([]byte("Webhook sent"))
}

// VULNERABLE: Image proxy without URL validation
func ImageProxy(w http.ResponseWriter, r *http.Request) {
    imageURL := r.URL.Query().Get("src")

    client := &http.Client{}
    resp, _ := client.Get(imageURL)
    defer resp.Body.Close()

    w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
    io.Copy(w, resp.Body)
}
`,
      }, 'Add vulnerable SSRF handlers');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);
      const result = await agent.runOnCommit(commitSha, agentCtx);

      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await assertLLM(
        'The security analysis identifies SSRF (Server-Side Request Forgery) ' +
        'vulnerabilities in Go. Making HTTP requests to user-provided URLs without ' +
        'validation allows attackers to access internal services.',
        analysisText,
        7
      );

      logTestResult('Go SSRF detection', evalResult);
      console.log(formatEvaluationResult('Go SSRF detection', evalResult));
    });
  });
});
