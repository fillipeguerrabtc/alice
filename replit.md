# Alice - Plataforma Enterprise de IA Autônoma

## Overview

Alice is a production-ready enterprise autonomous AI platform leveraging the Llama 4 Maverick (400B parameters) model hosted on Salad Cloud. It offers total autonomy, absolute data privacy, predictable costs, and unlimited customization through fine-tuning. The platform addresses common enterprise challenges such as third-party API dependencies, data privacy concerns, and unpredictable token-based costs. Key capabilities include real-time chat, deduplication, multi-tenancy, Role-Based Access Control (RBAC), RAG backend, and integrations with payment, CRM, and communication services.

## User Preferences

### The 16 Fundamental Rules

| Number | Rule | Description |
|---|---|---|
| 1 | READ BEFORE ACTING | Inspect files before implementing |
| 2 | DO NOT DUPLICATE | Check existing code first |
| 3 | STRUCTURED WORKFLOW | Diagnose → Plan → Approve → Implement |
| 4 | MANDATORY APPROVAL | Ask for approval before big changes |
| 5 | DO NOT LIE | Say "I don't know" when you don't know |
| 6 | NO TEMPORARY SOLUTIONS | **FORBIDDEN**: workarounds, mocks, hardcoded data, in-memory storage, false default values. ALL logic must be enterprise-grade with real persistence in PostgreSQL |
| 7 | MINIMAL CHANGES | Surgical focus on the problem |
| 8 | MANDATORY QUALITY | TypeScript strict, zero any, Pino |
| 9 | CONTINUOUS VALIDATION | Test after each micro-step |
| 10 | DOCUMENTATION PT-BR | ALL documentation in Portuguese |
| 11 | FOLLOW OFFICIAL DOCS | Best practices 2025 |
| 12 | PRODUCTION HETZNER | Deploy via GitHub Actions |
| 13 | INTERNATIONALIZATION | PT-BR primary, EN secondary |
| 14 | CHECK SECRETS | Check existing variables |
| 15 | MICROSERVICES | Code in apps/, shared in packages/ |
| 16 | BEST PRACTICES | API Gateway, health checks, circuit breakers |

### Language Preferences

| Context | Language |
|---|---|
| Documentation | Brazilian Portuguese |
| Code comments | Brazilian Portuguese |
| Log messages | Brazilian Portuguese |
| Variable names | English |
| Technical terms | English (OAuth, JWT, etc.) |

### Development Environment (Replit) Guidelines

The code in `apps/` (microservices) goes to production via GitHub Actions (Rule 12). The `server/index-dev.ts` file is ONLY for preview in Replit and DOES NOT go to production.

## System Architecture

The Alice platform is built as a microservices architecture, with core services handling specific functionalities.

### Core Architecture Decisions

*   **Learning Schedule:**
    *   RAG updates in real-time.
    *   Daily auto-indexing.
    *   Incremental fine-tuning every 4 days (LoRA).
    *   Full fine-tuning bi-weekly.
*   **Real-time Pub/Sub:** PostgreSQL NOTIFY for initial scale, with a fallback to `conversation_states` table for persistence. Redis will be considered for future scaling needs.
*   **Image Generation:** Uses FLUX.1 Schnell model (Apache 2.0), self-hosted on Salad Cloud with progressive LoRA training. Object storage and CLIP embeddings for multimodal RAG.
*   **Takeover/Handover:** Custom panel integrated into the dashboard, with automated triggers based on confidence scores, fallbacks, and sentiment analysis.
*   **Observability:** Dedicated, independent microservice (`apps/observability-service/`) for monitoring.
    *   Prometheus 3.0 for metric collection.
    *   Grafana OSS 11.3 for dashboards and alerts.
    *   Jaeger 1.62 for distributed tracing.
    *   OpenTelemetry Collector for unified instrumentation.
    *   Langfuse 2.x for LLM-specific metrics (Token Usage, TTFT, Latency, Error Rate, Cost per Request, RAG Retrieval Time).

### Technology Stack & Design

*   **Frontend:** React 18, TypeScript 5, Vite 5, shadcn/ui, Tailwind CSS, TanStack Query, Wouter, react-i18next.
*   **Authentication:** OAuth 2.0 (Google, GitHub, Microsoft), SAML 2.0 (Azure AD, Okta), local authentication with bcrypt, RBAC with 6 defined roles.
*   **Chat:** WebSocket for real-time communication, proxy to Salad Cloud, token streaming, message persistence.
*   **RAG:** Salad Cloud for embeddings, pgvector for vector search, chunking (500 chars, 50 overlap), circuit breaker (30s/50%/30s).
*   **Training:** Collects training data, uses SemHash for deduplication, manages fine-tuning jobs.
*   **Integrations:** Handles third-party services with defined circuit breakers.
*   **Security:** bcrypt for passwords, HttpOnly/Secure/SameSite cookies, OAuth state parameter for CSRF, IP/endpoint rate limiting, `tenant_id` isolation in queries.
*   **CI/CD:** GitHub Actions for automated build, push to GHCR, deploy via SSH to Hetzner, and health checks.
*   **Code Standards:** Pino for logging (no `console.log`), TypeScript strict mode (no `any`), mandatory health checks at `/api/service/health`.

## External Dependencies

*   **Salad Cloud:**
    *   **LLM Principal:** Llama 4 Maverick (400B parameters) for multimodal input (text, images, video) and text-only output. Provides embeddings via `text-embedding-3-small`.
    *   **Image Generation:** FLUX.1 Schnell model (Apache 2.0) self-hosted on dedicated GPU instances.
    *   **CLIP Inference:** CLIP ViT-L/14 model (MIT License) self-hosted for multimodal (text and image) embeddings.
*   **Stripe:** For EUR payments via SEPA and webhook processing.
*   **Wise:** For international money transfers across 50+ currencies.
*   **ERPNext:** Integrated CRM and ERP system.
*   **Twilio:** For WhatsApp and SMS communication.
*   **Resend:** For transactional email services.
*   **PostgreSQL:** Primary database with `pgvector` extension for vector search.
*   **Hetzner Cloud:** Production hosting environment.
*   **GitHub Actions:** CI/CD pipeline.