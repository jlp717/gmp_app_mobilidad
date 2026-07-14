## ADDED Requirements

### Requirement: Technical separation from execution
The system SHALL enforce a one-way flow from sourced facts to analysis, portfolio/suitability constraints and explanation; the decision-support module MUST NOT invoke a broker, create an order or enqueue an offline financial transaction.

#### Scenario: User opens an investment idea
- **WHEN** the app presents an analyzed instrument or fund
- **THEN** it provides context and explanation without an automatic execution path or broker credential

#### Scenario: Retry after network failure
- **WHEN** a decision-support read fails and is retried
- **THEN** no financial mutation or duplicate order can occur because the module has no execution capability

### Requirement: Suitability gate for personalized recommendations
Before producing a personalized product recommendation, the system SHALL have a current profile covering knowledge/experience, objectives, horizon, financial situation, ability to bear loss, risk tolerance and applicable restrictions; missing information MUST block personalization.

#### Scenario: Incomplete investor profile
- **WHEN** ability to bear loss or horizon is missing/expired
- **THEN** the system limits output to general information and explains why no personalized recommendation is available

### Requirement: Durable explanation and uncertainty
Every scored idea or personalized recommendation SHALL retain model/rule version, input observations and age, thesis, assumptions, confidence, downside, scenarios, costs, conflicts, alternatives, suitability result and invalidation conditions.

#### Scenario: User inspects a high score
- **WHEN** a ranking is displayed
- **THEN** the UI shows evidence, uncertainty and downside and does not present the score as a guarantee

#### Scenario: Source becomes stale
- **WHEN** a material input passes its freshness limit
- **THEN** the explanation is marked stale and the actionable recommendation is withdrawn or downgraded

### Requirement: Portfolio-aware risk context
The system SHALL evaluate concentration, issuer/sector/country/currency exposure, correlation, volatility/drawdown, liquidity/spread, leverage and product-specific risks against the user's constraints before ranking additions to a portfolio.

#### Scenario: Attractive asset worsens concentration
- **WHEN** an asset scores positively in isolation but breaches the portfolio concentration limit
- **THEN** portfolio context overrides the isolated rank and explains the constraint

### Requirement: Versioned event context
Corporate, fund and macro events SHALL preserve scheduled/confirmed/estimated/revised/cancelled states, source, publication/retrieval times and revisions rather than overwriting history.

#### Scenario: Earnings date revised
- **WHEN** an issuer changes a scheduled earnings date
- **THEN** the prior version remains auditable, alerts are reconciled and analysis uses the newest confirmed version

### Requirement: Reproducible simulation and backtests
Any simulation/backtest SHALL use point-in-time identities/data, delistings, corporate actions, realistic costs/slippage and documented train/out-of-sample periods, and SHALL disclose look-ahead, survivorship and data-snooping limitations.

#### Scenario: Historical ranking test
- **WHEN** a strategy is evaluated historically
- **THEN** the result records dataset/model versions and rejects future-revised inputs that were unavailable at decision time

### Requirement: Privacy and data minimization
Investor profile, holdings and constraints SHALL be treated as sensitive, collected only when required, encrypted at rest/in transit, scoped to the authenticated user, auditable and subject to explicit retention/deletion controls.

#### Scenario: Phase-one market session view
- **WHEN** the user only views XMAD session context
- **THEN** the backend does not require or persist portfolio quantities or suitability data

### Requirement: No performance guarantees
The product SHALL clearly distinguish analysis from certainty and MUST NOT claim that AI, models or historical results can predict markets or guarantee returns.

#### Scenario: Decision-support copy
- **WHEN** a result is rendered in UI or notification
- **THEN** it uses probabilistic/conditional language and includes relevant risk and data-quality context

