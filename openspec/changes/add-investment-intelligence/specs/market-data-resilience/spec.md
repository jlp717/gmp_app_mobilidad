## ADDED Requirements

### Requirement: Provider-neutral adapters
The backend SHALL access calendars, status and reference data only through explicit provider ports, and provider-specific payloads MUST be normalized before entering application or Flutter contracts.

#### Scenario: Replace the primary calendar provider
- **WHEN** a configured provider is replaced by another adapter
- **THEN** domain/API consumers keep the same canonical states and only adapter/configuration code changes

#### Scenario: Deterministic tests
- **WHEN** unit or contract tests run
- **THEN** they use a fake provider and fixed clock without network or credentials

### Requirement: Provenance and freshness envelope
Every external observation SHALL include provider/source, observed/retrieved/as-of times, validity window, effective dates, parser/calendar version, confidence and required attribution/licensing metadata.

#### Scenario: Fresh observation
- **WHEN** an observation is within its declared validity and no conflict exists
- **THEN** the domain marks its data state `FRESH` and exposes the relevant source/freshness fields

#### Scenario: Stale observation
- **WHEN** an observation is older than fresh TTL but inside an explicitly permitted stale window
- **THEN** the result is `DEGRADED`, retains the original `asOf` and adds a stale warning

### Requirement: Conflict and absence safety
The system SHALL apply an explicit source-priority policy and MUST return `CONFLICT` or `UNKNOWN` when material sources disagree or evidence is absent; a failure MUST NOT be translated into `OPEN` or `CLOSED`.

#### Scenario: Official halt conflicts with normalized provider
- **WHEN** a primary venue source reports a halt and a normalized provider still reports open
- **THEN** the context uses the authoritative halt, records the conflict and emits a quality metric

#### Scenario: All providers unavailable
- **WHEN** all permitted providers and safe caches are unavailable
- **THEN** the domain returns `UNKNOWN` with typed warnings and no actionable recommendation

### Requirement: Transition-aware cache and single-flight
The backend SHALL cache by provider, MIC/entity, effective session date and data version; TTL MUST be bounded by the next transition/validity, and concurrent misses for the same key SHALL share one upstream request.

#### Scenario: Concurrent market-state requests
- **WHEN** many authenticated clients request the same MIC before cache fill completes
- **THEN** the backend performs one upstream fetch and fans out the normalized result

#### Scenario: Cached state crosses known transition
- **WHEN** cached `OPEN` evidence reaches its known closing transition
- **THEN** the cache cannot continue returning `OPEN` as fresh and the system refreshes or returns `UNKNOWN/DEGRADED`

### Requirement: Bounded external I/O and typed errors
Provider calls SHALL enforce input limits, connection/response timeout, cancellation, rate-limit handling and explicit retry policy. Only idempotent reads MAY retry with bounded exponential backoff and jitter.

#### Scenario: Provider timeout with safe stale data
- **WHEN** the provider times out and permitted stale evidence exists
- **THEN** the request returns `DEGRADED`, records timeout/cache-hit metrics and does not wait beyond the endpoint budget

#### Scenario: Provider rejects credentials
- **WHEN** upstream authentication fails
- **THEN** the backend logs a redacted operational error, returns a typed unavailable state and never exposes the token or raw provider response

### Requirement: Backend-only secrets and license controls
Flutter MUST NOT contain provider or broker secrets. The backend SHALL enforce provider entitlements, display attribution, retention and redistribution constraints defined by configuration/contract.

#### Scenario: Mobile request
- **WHEN** Flutter requests market context
- **THEN** it receives only normalized permitted fields and attribution, never an upstream credential or disallowed raw payload

### Requirement: Market-data observability
The system SHALL measure adapter latency/error, rate-limit events, cache hit/stale hit, observation age and counts of `DEGRADED`, `CONFLICT` and `UNKNOWN` without high-cardinality secrets or personal portfolio labels.

#### Scenario: Provider degradation
- **WHEN** a provider begins timing out
- **THEN** metrics distinguish upstream failure from cache behavior and reveal the age/quality of responses

