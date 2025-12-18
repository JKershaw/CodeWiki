# Configuration & Deployment

## Executive Summary

CodeWiki is designed for flexible deployment across diverse environments: local development machines, cloud infrastructure, CI/CD pipelines, and containerized platforms. Configuration is managed through environment variables and configuration files, following twelve-factor app principles.

**Deployment Modes:**

1. **Local Development**: File-based storage, minimal setup
2. **Team Collaboration**: MongoDB storage, web UI enabled
3. **CI/CD Integration**: Automated generation, artifact output
4. **Production Hosting**: Scalable, monitored, secure

**Configuration Philosophy:**

- **Environment-Driven**: All configuration via environment variables
- **Sensible Defaults**: Works out-of-box for common cases
- **Fail-Safe**: Invalid configuration caught early with clear errors
- **Observable**: Configuration visible in status and logs

---

## Table of Contents

1. [Configuration System](#configuration-system)
2. [Environment Variables Reference](#environment-variables-reference)
3. [Storage Configuration](#storage-configuration)
4. [LLM Configuration](#llm-configuration)
5. [Web Server Configuration](#web-server-configuration)
6. [Security Configuration](#security-configuration)
7. [Deployment Modes](#deployment-modes)
8. [Docker Deployment](#docker-deployment)
9. [Cloud Deployment](#cloud-deployment)
10. [Monitoring & Observability](#monitoring--observability)

---

## Configuration System

### Configuration Hierarchy

```mermaid
graph TD
    A[Final Configuration] --> B[Environment Variables]
    A --> C[Config File]
    A --> D[CLI Arguments]
    A --> E[Built-in Defaults]

    B --> F{Highest Priority}
    D --> F
    C --> G{Medium Priority}
    E --> H{Lowest Priority}
```

**Priority Order** (highest to lowest):
1. CLI arguments (`--option=value`)
2. Environment variables (`ENV_VAR=value`)
3. Configuration file (`.codewikirc` or `codewiki.config.js`)
4. Built-in defaults

---

### Configuration File

**Supported Formats:**

- `.env` - Environment variables
- `.codewikirc` - JSON configuration
- `codewiki.config.js` - JavaScript configuration (advanced)

**Example `.codewikirc`:**

```json
{
  "storage": {
    "backend": "mongodb",
    "mongodbUri": "mongodb://localhost:27017/codewiki"
  },
  "llm": {
    "provider": "openrouter",
    "defaultModel": "anthropic/claude-3-opus",
    "temperature": 0.7
  },
  "server": {
    "port": 3000,
    "host": "0.0.0.0"
  },
  "logging": {
    "level": "info",
    "format": "json"
  }
}
```

---

## Environment Variables Reference

### Core Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | development | Environment mode (development/production) |
| `LOG_LEVEL` | No | info | Logging level (debug/info/warn/error) |
| `DATA_DIR` | No | ./.codewiki-data | Data directory path |

---

### Storage Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STORAGE_BACKEND` | No | file | Storage backend (file/mongodb) |
| `FILE_STORAGE_PATH` | No | ./.codewiki-data | Path for file-based storage |
| `MONGODB_URI` | If MongoDB | - | MongoDB connection string |
| `MONGODB_DATABASE` | No | codewiki | MongoDB database name |

**MongoDB URI Format:**

```
mongodb://[username:password@]host[:port][/database][?options]

Examples:
mongodb://localhost:27017/codewiki
mongodb://user:pass@cluster.mongodb.net/codewiki?retryWrites=true
mongodb+srv://cluster.mongodb.net/codewiki
```

---

### LLM Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENROUTER_API_KEY` | Yes | - | OpenRouter API key for LLM access |
| `LLM_PROVIDER` | No | openrouter | LLM provider (openrouter/openai/azure) |
| `LLM_DEFAULT_MODEL` | No | qwen/qwen-turbo | Default model for agents |
| `LLM_EVALUATOR_MODEL` | No | qwen/qwen-turbo | Model for benchmarking |
| `LLM_TEMPERATURE` | No | 0.7 | Temperature for generation (0-2) |
| `LLM_MAX_TOKENS` | No | 4000 | Max tokens per request |
| `LLM_TIMEOUT` | No | 60000 | Request timeout in milliseconds |
| `LLM_RETRY_ATTEMPTS` | No | 3 | Number of retry attempts |

---

### Web Server Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3000 | Web server port |
| `HOST` | No | localhost | Server host (use 0.0.0.0 for all interfaces) |
| `BASE_URL` | No | http://localhost:3000 | Public URL for the application |
| `SESSION_SECRET` | Production | - | Secret for session signing |
| `CORS_ORIGINS` | No | * | Allowed CORS origins (comma-separated) |
| `RATE_LIMIT_WINDOW` | No | 900000 | Rate limit window (15 min) |
| `RATE_LIMIT_MAX` | No | 100 | Max requests per window |

---

### GitHub OAuth Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_CLIENT_ID` | If OAuth | - | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | If OAuth | - | GitHub OAuth app secret |
| `GITHUB_CALLBACK_URL` | If OAuth | /auth/github/callback | OAuth callback URL |

---

### MCP Server Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MCP_SERVER_PORT` | No | 3100 | MCP server port |
| `MCP_AUTH_TOKEN` | No | - | Token for MCP authentication |
| `MCP_ENABLE_RESOURCES` | No | true | Enable MCP resources |
| `MCP_ENABLE_TOOLS` | No | true | Enable MCP tools |

---

### Quality & Benchmarking

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BENCHMARK_DEFAULT_SAMPLE_SIZE` | No | 100 | Default pages to benchmark |
| `BENCHMARK_QUALITY_THRESHOLD` | No | 7.0 | Minimum passing quality score |
| `BENCHMARK_MAX_COST` | No | - | Max cost per benchmark (USD) |
| `AUTO_BENCHMARK_ENABLED` | No | false | Enable auto-benchmarking |
| `AUTO_BENCHMARK_SCHEDULE` | No | - | Cron schedule for auto-benchmark |

---

### Advanced Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AGENT_CONCURRENCY` | No | 5 | Max concurrent agent executions |
| `WORK_QUEUE_SIZE` | No | 1000 | Max work items in queue |
| `CACHE_ENABLED` | No | true | Enable caching |
| `CACHE_TTL` | No | 3600 | Cache TTL in seconds |
| `ENABLE_METRICS` | No | false | Enable Prometheus metrics |
| `METRICS_PORT` | No | 9090 | Metrics server port |

---

## Storage Configuration

### File-Based Storage

**Configuration:**

```env
STORAGE_BACKEND=file
FILE_STORAGE_PATH=/var/lib/codewiki/data
```

**Directory Structure:**

```
/var/lib/codewiki/data/
├── repositories/
│   └── repo-{id}.json
├── pages/
│   ├── page-{id}.json
│   └── versions/
├── workItems/
├── benchmarks/
└── system/
    ├── config.json
    └── state.json
```

**Pros:**
- Simple setup, no database required
- Easy backup (just copy directory)
- Version control friendly
- Good for single-user scenarios

**Cons:**
- No concurrent access
- Slower for large datasets
- No query optimization
- Manual synchronization needed

---

### MongoDB Storage

**Configuration:**

```env
STORAGE_BACKEND=mongodb
MONGODB_URI=mongodb://localhost:27017/codewiki
MONGODB_DATABASE=codewiki
```

**Connection Options:**

```env
# With authentication
MONGODB_URI=mongodb://user:password@localhost:27017/codewiki

# MongoDB Atlas
MONGODB_URI=mongodb+srv://cluster.mongodb.net/codewiki?retryWrites=true&w=majority

# Replica set
MONGODB_URI=mongodb://host1:27017,host2:27017,host3:27017/codewiki?replicaSet=rs0
```

**Collections Created:**

- repositories
- files
- pages
- pageVersions
- topics
- workItems
- phases
- qualityMetrics
- benchmarks
- agents
- tools
- toolExecutions

**Pros:**
- Concurrent access supported
- Fast queries with indexes
- Scalable to large datasets
- Built-in replication and sharding
- Good for team/production use

**Cons:**
- Requires MongoDB installation
- More complex setup
- Additional infrastructure cost

---

### Storage Migration

**File → MongoDB:**

```bash
codewiki migrate \
  --from file://.codewiki-data \
  --to mongodb://localhost:27017/codewiki
```

**MongoDB → File:**

```bash
codewiki migrate \
  --from mongodb://localhost:27017/codewiki \
  --to file://.codewiki-data-new
```

---

## LLM Configuration

### Provider Configuration

**OpenRouter (Default):**

```env
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-...
LLM_DEFAULT_MODEL=anthropic/claude-3-opus
```

**Available Models via OpenRouter:**
- `anthropic/claude-3-opus` - Best quality, higher cost
- `anthropic/claude-3-sonnet` - Balanced
- `openai/gpt-4-turbo` - High quality
- `openai/gpt-3.5-turbo` - Fast, economical
- `qwen/qwen-turbo` - Very economical, good for benchmarking

---

**Direct OpenAI:**

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
LLM_DEFAULT_MODEL=gpt-4-turbo-preview
```

---

**Azure OpenAI:**

```env
LLM_PROVIDER=azure
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT_NAME=your-deployment
LLM_DEFAULT_MODEL=gpt-4
```

---

### Model Selection Strategy

**By Use Case:**

| Use Case | Recommended Model | Reason |
|----------|-------------------|---------|
| Initial wiki generation | anthropic/claude-3-sonnet | Balance of quality and cost |
| Benchmarking | qwen/qwen-turbo | Low cost, sufficient accuracy |
| Critical documentation | anthropic/claude-3-opus | Highest quality |
| Rapid iteration | openai/gpt-3.5-turbo | Fast, cheap |
| Code analysis | anthropic/claude-3-opus | Best code understanding |

---

### Cost Management

**Budget Limits:**

```env
LLM_MAX_COST_PER_DAY=50.00
LLM_MAX_COST_PER_WEEK=200.00
LLM_COST_ALERT_THRESHOLD=0.80
```

**Cost Tracking:**

```bash
# View current costs
codewiki costs --period=today

# View cost breakdown
codewiki costs --by=agent --period=week
```

---

## Web Server Configuration

### Basic Setup

**Development:**

```env
PORT=3000
HOST=localhost
NODE_ENV=development
```

**Production:**

```env
PORT=8080
HOST=0.0.0.0
NODE_ENV=production
BASE_URL=https://wiki.example.com
SESSION_SECRET=your-random-secret-here
```

---

### HTTPS Configuration

**Option 1: Reverse Proxy (Recommended)**

Use nginx or Apache as reverse proxy with SSL termination:

```nginx
server {
    listen 443 ssl http2;
    server_name wiki.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Option 2: Built-in HTTPS**

```env
HTTPS_ENABLED=true
HTTPS_CERT_PATH=/path/to/cert.pem
HTTPS_KEY_PATH=/path/to/key.pem
PORT=443
```

---

### CORS Configuration

**Development (allow all):**

```env
CORS_ORIGINS=*
```

**Production (specific origins):**

```env
CORS_ORIGINS=https://app.example.com,https://dashboard.example.com
```

---

### Rate Limiting

**Configuration:**

```env
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW=900000  # 15 minutes
RATE_LIMIT_MAX=100         # 100 requests per window
```

**Per-Endpoint Limits:**

```typescript
// config/rateLimits.js
module.exports = {
  '/api/pages': { max: 200, window: 900000 },
  '/api/benchmarks/run': { max: 10, window: 3600000 },
  '/api/system/process': { max: 5, window: 3600000 }
};
```

---

## Security Configuration

### Authentication

**Session-Based:**

```env
SESSION_SECRET=your-long-random-secret
SESSION_MAX_AGE=86400000  # 24 hours
SESSION_SECURE=true        # Require HTTPS
SESSION_SAME_SITE=strict
```

**JWT-Based:**

```env
JWT_SECRET=your-jwt-secret
JWT_EXPIRES_IN=24h
JWT_ALGORITHM=HS256
```

---

### API Security

```env
# Require authentication for all API endpoints
API_AUTH_REQUIRED=true

# Allow anonymous read-only access
API_ANONYMOUS_READ=true

# API key for server-to-server
API_KEY=your-api-key
```

---

### Content Security Policy

```env
CSP_ENABLED=true
CSP_REPORT_ONLY=false
CSP_DIRECTIVES="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
```

---

## Deployment Modes

### Mode 1: Local Development

**Setup:**

```bash
# Clone repository
git clone https://github.com/yourorg/codewiki

# Install dependencies
npm install

# Configure
cp .env.example .env
# Edit .env with your OPENROUTER_API_KEY

# Run
npm run dev
```

**Configuration:**

```env
NODE_ENV=development
STORAGE_BACKEND=file
FILE_STORAGE_PATH=./.codewiki-data
PORT=3000
LOG_LEVEL=debug
```

---

### Mode 2: Team Server

**Setup:**

```bash
# Install CodeWiki globally
npm install -g codewiki

# Set up MongoDB
docker run -d -p 27017:27017 --name codewiki-mongo mongo:latest

# Configure
export STORAGE_BACKEND=mongodb
export MONGODB_URI=mongodb://localhost:27017/codewiki
export OPENROUTER_API_KEY=your-key
export SESSION_SECRET=your-secret

# Start server
codewiki serve --port 3000
```

**Configuration:**

```env
NODE_ENV=production
STORAGE_BACKEND=mongodb
MONGODB_URI=mongodb://localhost:27017/codewiki
PORT=3000
HOST=0.0.0.0
BASE_URL=https://wiki.yourteam.com
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-secret
SESSION_SECRET=your-random-secret
```

---

### Mode 3: CI/CD Integration

**Configuration:**

```env
NODE_ENV=production
STORAGE_BACKEND=file
FILE_STORAGE_PATH=/tmp/codewiki-output
OPENROUTER_API_KEY=${CI_SECRET_OPENROUTER_KEY}
LOG_LEVEL=info
```

**Usage in CI:**

```yaml
- name: Generate Wiki
  run: |
    codewiki process --repository . --output-dir ./wiki-artifacts
  env:
    OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

---

## Docker Deployment

### Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application
COPY . .

# Build
RUN npm run build

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

# Start server
CMD ["npm", "start"]
```

---

### Docker Compose

```yaml
version: '3.8'

services:
  codewiki:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - STORAGE_BACKEND=mongodb
      - MONGODB_URI=mongodb://mongo:27017/codewiki
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
      - SESSION_SECRET=${SESSION_SECRET}
    depends_on:
      - mongo
    volumes:
      - ./repositories:/app/repositories
    restart: unless-stopped

  mongo:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db
    restart: unless-stopped

volumes:
  mongodb_data:
```

**Running:**

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f codewiki

# Stop services
docker-compose down
```

---

## Cloud Deployment

### AWS Deployment

**Architecture:**

```mermaid
graph TD
    A[Route 53] --> B[ALB]
    B --> C[ECS Fargate]
    C --> D[CodeWiki Container]
    D --> E[MongoDB Atlas]
    D --> F[S3 for Artifacts]
```

**ECS Task Definition:**

```json
{
  "family": "codewiki",
  "containerDefinitions": [
    {
      "name": "codewiki",
      "image": "yourregistry/codewiki:latest",
      "portMappings": [{"containerPort": 3000}],
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "STORAGE_BACKEND", "value": "mongodb"}
      ],
      "secrets": [
        {"name": "MONGODB_URI", "valueFrom": "arn:aws:secretsmanager:..."},
        {"name": "OPENROUTER_API_KEY", "valueFrom": "arn:aws:secretsmanager:..."}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/codewiki",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

---

### Kubernetes Deployment

**Deployment:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: codewiki
spec:
  replicas: 3
  selector:
    matchLabels:
      app: codewiki
  template:
    metadata:
      labels:
        app: codewiki
    spec:
      containers:
      - name: codewiki
        image: codewiki:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: production
        - name: STORAGE_BACKEND
          value: mongodb
        - name: MONGODB_URI
          valueFrom:
            secretKeyRef:
              name: codewiki-secrets
              key: mongodb-uri
        - name: OPENROUTER_API_KEY
          valueFrom:
            secretKeyRef:
              name: codewiki-secrets
              key: openrouter-key
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

**Service:**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: codewiki
spec:
  type: LoadBalancer
  ports:
  - port: 80
    targetPort: 3000
  selector:
    app: codewiki
```

---

## Monitoring & Observability

### Logging

**Configuration:**

```env
LOG_LEVEL=info          # debug, info, warn, error
LOG_FORMAT=json         # json or text
LOG_OUTPUT=stdout       # stdout, file, or both
LOG_FILE_PATH=/var/log/codewiki/app.log
```

**Structured Logging:**

```json
{
  "level": "info",
  "timestamp": "2025-12-18T10:00:00.000Z",
  "message": "Wiki generation started",
  "context": {
    "repositoryId": "repo-123",
    "phase": "reconnaissance",
    "userId": "user-456"
  }
}
```

---

### Metrics

**Prometheus Metrics:**

```env
ENABLE_METRICS=true
METRICS_PORT=9090
```

**Available Metrics:**

- `codewiki_pages_total` - Total wiki pages
- `codewiki_quality_score` - Average quality score
- `codewiki_agent_executions_total` - Agent execution count
- `codewiki_llm_tokens_total` - Total LLM tokens used
- `codewiki_llm_cost_total` - Total LLM API cost
- `codewiki_http_requests_total` - HTTP request count
- `codewiki_http_request_duration_seconds` - Request latency

---

### Health Checks

**Endpoints:**

```
GET /health       # Basic health check
GET /ready        # Readiness check (dependencies)
GET /metrics      # Prometheus metrics
```

**Health Check Response:**

```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600,
  "checks": {
    "storage": "ok",
    "llm": "ok",
    "memory": "ok"
  }
}
```

---

## Appendix: Environment Template

```env
# Core Configuration
NODE_ENV=production
LOG_LEVEL=info

# Storage
STORAGE_BACKEND=mongodb
MONGODB_URI=mongodb://localhost:27017/codewiki

# LLM
OPENROUTER_API_KEY=your-api-key-here
LLM_DEFAULT_MODEL=qwen/qwen-turbo
LLM_TEMPERATURE=0.7

# Web Server
PORT=3000
HOST=0.0.0.0
BASE_URL=https://wiki.example.com
SESSION_SECRET=your-random-secret-here

# GitHub OAuth (optional)
# GITHUB_CLIENT_ID=your-client-id
# GITHUB_CLIENT_SECRET=your-client-secret

# MCP Server (optional)
# MCP_SERVER_PORT=3100
# MCP_AUTH_TOKEN=your-mcp-token

# Monitoring (optional)
# ENABLE_METRICS=true
# METRICS_PORT=9090
```

---

**Document Version**: 1.0
**Last Updated**: 2025-12-18
**Related Documents**:
- USER_WORKFLOWS.md - User configuration scenarios
- INTEGRATION_PATTERNS.md - Integration configuration
- ARCHITECTURE.md - System architecture
