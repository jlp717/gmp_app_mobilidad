## ADDED Requirements

### Requirement: Fund-specific valuation context
The system SHALL model a traditional fund share class with dealing calendar, IANA timezone, valuation frequency/point, manager and distributor cutoffs, NAV date, NAV publication time, settlement lag, fees and suspension/gate status.

#### Scenario: Fund requested before cutoff
- **WHEN** a valuation context is requested before the applicable cutoff on a dealing day
- **THEN** the system identifies the candidate current valuation date and labels any unpublished NAV as pending

#### Scenario: Fund requested after cutoff
- **WHEN** a valuation context is requested after the applicable distributor or manager cutoff
- **THEN** the system advances to the next valid dealing day and never describes the exchange close as the fund deadline

### Requirement: Authoritative fund evidence
The system SHALL attach prospectus/KID or authorized provider provenance, effective date and freshness to every cutoff and valuation rule; missing or expired rules MUST produce `UNKNOWN`.

#### Scenario: Prospectus data unavailable
- **WHEN** no current authoritative cutoff/valuation rule exists for a share class
- **THEN** the system returns `UNKNOWN`, explains the missing evidence and does not estimate a deadline

### Requirement: Fund suspensions and exceptional dealing
The system SHALL represent notice periods, gates, suspended subscriptions/redemptions and exceptional non-dealing days separately from normal NAV publication.

#### Scenario: Redemptions suspended
- **WHEN** the authoritative fund status suspends redemptions
- **THEN** the context identifies the affected operation and does not imply that a known NAV makes redemption available

### Requirement: ETF price and NAV separation
The system SHALL treat an ETF as an exchange-traded listing for session status while presenting market price, NAV/iNAV, premium/discount and freshness as separate observations.

#### Scenario: ETF trades while NAV is stale
- **WHEN** an ETF market price is current but NAV is older than its permitted freshness window
- **THEN** the UI may show the live listing state but marks NAV and premium/discount as stale or unavailable

