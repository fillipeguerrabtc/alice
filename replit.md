## Overview

Alice is an autonomous enterprise AI platform designed for businesses requiring full control over their data and AI inference. It utilizes a self-hosted **Llama 4 Maverick (400B parameters)** language model via Salad Cloud, ensuring total autonomy, absolute privacy, predictable costs, unlimited customization through fine-tuning, and guaranteed availability without reliance on third-party APIs like OpenAI or Anthropic.

The platform addresses critical challenges faced by AI-implementing companies: dependence on third parties, data privacy concerns, and unpredictable costs. Alice provides a 100% company-controlled AI solution for medium to large enterprises, ensuring compliance with privacy regulations like LGPD and GDPR. It targets organizations with stringent privacy requirements, sensitive data (healthcare, finance, legal), those seeking cost control, and those needing deep model customization.

Key capabilities include: a proprietary AI model, real-time chat with conversation context, semantic deduplication for training data, multi-tenant isolation, RBAC access control, a RAG backend with pgvector, Stripe and Wise payment integrations, ERPNext CRM integration, Twilio for WhatsApp/SMS, Resend for transactional emails, enterprise authentication (OAuth/SAML), an API Gateway (Traefik), and a robust CI/CD pipeline (GitHub Actions for Hetzner deployment).

## User Preferences

These rules are NON-NEGOTIABLE and must be followed in ALL implementations:

1.  **READ BEFORE ACTING**: It is FORBIDDEN to implement any code without first inspecting existing files, understanding current flows, and mapping dependencies. Always use search tools (grep, glob, read) before writing any new code.
2.  **DO NOT DUPLICATE**: Before creating any functionality, ALWAYS check if a similar implementation already exists. First find and reuse existing code. Code duplication is strictly prohibited.
3.  **STRUCTURED WORKFLOW**: All work must follow the sequence: problem diagnosis → reading existing code → drafting a minimal plan → user approval → micro-implementation → immediate validation.
4.  **MANDATORY APPROVAL**: Any significant technical decision requires STOPPING and explicitly asking for user approval before proceeding. Never assume a major change is authorized.
5.  **DO NOT LIE**: If you don't know something, clearly state "I don't know." If you haven't verified, say "I haven't verified." Assumptions and false statements are strictly prohibited.
6.  **NO TEMPORARY SOLUTIONS**: It is FORBIDDEN to implement: workarounds, hardcoded values in production code, mocks that go to production, placeholders, hacks, or any "temporary" solution.
7.  **MINIMAL CHANGES**: Never refactor code outside the scope approved by the user. Maintain surgical focus only on the specific problem being solved.
8.  **MANDATORY QUALITY**: All code must use TypeScript in strict mode, have zero LSP errors, never use the `any` type, and strictly use Pino for logging.
9.  **CONTINUOUS VALIDATION**: Validate correct functioning after EACH micro-step of implementation. Never accumulate multiple changes without testing.
10. **DOCUMENTATION IN PT-BR**: ALL documentation, code comments, and log messages must be in Brazilian Portuguese. Only established technical terms (such as OAuth, WebSocket, Circuit Breaker) may remain in English.
11. **FOLLOW OFFICIAL DOCUMENTATION**: ALWAYS consult and follow the official documentation of libraries and frameworks. Apply 2025 best practices.
12. **PRODUCTION ON HETZNER**: Replit is ONLY an IDE for code editing. The production application runs 100% on the Hetzner CX43 server (8 vCPUs, 16GB RAM, IP: 46.224.46.93) via deployment through GitHub Actions.
13. **MANDATORY INTERNATIONALIZATION**: Brazilian Portuguese (PT-BR) as the primary language, English (EN) as secondary. All pages must have a functional language selector.
14. **CHECK EXISTING SECRETS**: ALWAYS verify which secrets are already configured before implementing integrations. Use the `view_env_vars` tool to list existing variables.
15. **MICROSERVICES ARCHITECTURE**: Monolithic code is FORBIDDEN. Services should be in `apps/`, shared code in `packages/`. Each service must be independent and containerizable.
16. **2025 BEST PRACTICES**: Mandatorily implement: API Gateway, health checks in all services, circuit breakers for external services, rate limiting, container-ready applications.

## System Architecture

The Alice platform employs a microservices architecture orchestrated by Docker Compose, with a Traefik API Gateway handling external traffic. All services are containerized and deployed on Hetzner Cloud.

**Core Services:**
-   **Frontend Service (Port 5000):** React 18, TypeScript 5, Vite 5, shadcn/ui, Tailwind CSS 4, TanStack Query, Wouter, react-i18next. Handles UI rendering, state management, routing, and real-time chat via WebSocket.
-   **Authentication Service (Port 3001):** Node.js, Express, TypeScript. Manages OAuth 2.0 (Google, GitHub, Microsoft), SAML 2.0 (Azure AD, Okta), local authentication with bcrypt, session management (PostgreSQL), and RBAC with 6 hierarchical levels (super\_admin, admin, manager, operator, viewer, guest).
-   **Chat Service (Port 3002):** Node.js, Express, TypeScript. Provides a WebSocket server for real-time conversations, proxies requests to Salad Cloud's Llama 4 Maverick LLM, manages conversation context, streams tokens, and persists messages.
-   **RAG Service (Port 3003):** Node.js, Express, TypeScript. Handles embedding generation via Salad Cloud, vector storage with pgvector, semantic search, intelligent document chunking (500 char chunks, 50 char overlap), and content-hash deduplication. Includes a circuit breaker for Salad Cloud (30s timeout, 50% error threshold, 30s reset).
-   **Training Service (Port 3004):** Node.js, Express, TypeScript. Collects conversation data for training, performs semantic deduplication using SemHash (SHA-256 hash + cosine similarity > 0.85), manages fine-tuning jobs (pending, preparing, training, completed, failed), and integrates with Salad Cloud for fine-tuning.
-   **Integrations Service (Port 3005):** Node.js, Express, TypeScript. Centralizes all third-party integrations with circuit breakers for external APIs and webhook validation.
-   **API Gateway (Traefik v3.1):** Handles SSL termination (Let's Encrypt), intelligent routing, rate limiting, load balancing, and active health checks for microservices.

**Database:** PostgreSQL 16 with pgvector extension for vector search. Features multi-tenant isolation, JSONB for flexible configurations, and audit logs.

**Shared Components (`packages/`):** Centralized Drizzle ORM schema, PostgreSQL connection utilities, Pino logger configuration, and Zod validation schemas for consistency across services.

**UI/UX Design:** Frontend built with React, utilizing shadcn/ui for accessible components, Tailwind CSS 4 for utility-first styling, and Framer Motion for animations. Supports light/dark themes and PT-BR/EN internationalization.

**CI/CD Pipeline (GitHub Actions):** Automates build, push to GitHub Container Registry, and deployment to Hetzner Cloud. Includes code quality checks (ESLint, TypeScript), Docker image builds for each service, and SSH-based deployment, followed by health checks with automatic rollback if services fail.

**Security:** Implements bcrypt for password hashing, HttpOnly/Secure/SameSite=Strict cookies, CSRF protection, SAML signature validation, session expiration, IP-based rate limiting, role-based access control (RBAC), tenant isolation, least privilege principle, Zod for input validation, parameterized queries, and structured logging without sensitive data.

## External Dependencies

-   **Salad Cloud:** Provides GPUs for hosting the Llama 4 Maverick (400B parameters) LLM for inference and `text-embedding-3-small` for generating embeddings.
-   **Stripe Portugal:** Used for receiving payments in EUR, including SEPA, managing subscriptions, and processing webhooks (e.g., `checkout.session.completed`, `payment_intent.succeeded`).
-   **Wise:** Integrated for sending international payments to suppliers and partners in various currencies, incorporating a circuit breaker (15s timeout, 50% error, 30s reset).
-   **ERPNext:** A self-hosted CRM/ERP system used for centralizing sales, customer data, and financial operations, with automatic synchronization via webhooks.
-   **Twilio:** Utilized for WhatsApp and SMS communication (customer support, notifications), supporting both inbound and outbound messages.
-   **Resend:** Provides transactional email services for sending confirmations, notifications, and password reset emails using templates.
-   **Let's Encrypt:** For automatic SSL/TLS certificates managed by Traefik.
-   **DuckDNS:** A free dynamic DNS service for managing production URLs.