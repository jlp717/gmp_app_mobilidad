## ADDED Requirements

### Requirement: Instrument, listing and venue separation
The system SHALL model an economic instrument separately from each listing and venue, and every listing SHALL reference a MIC, currency and effective validity interval.

#### Scenario: Same instrument listed on multiple venues
- **WHEN** one instrument has listings on two MICs
- **THEN** each listing retains its own market context and currency while both resolve to the same instrument identity

### Requirement: Canonical identifiers and aliases
The system SHALL support canonical identifiers such as ISIN, FIGI, CFI and MIC plus provider/broker aliases with source and effective dates; ticker alone MUST NOT be treated as globally unique.

#### Scenario: Ticker collision
- **WHEN** the same ticker maps to more than one active listing
- **THEN** the resolver requires additional evidence and does not select an instrument automatically

#### Scenario: Symbol change
- **WHEN** a listing changes symbol on an effective date
- **THEN** historical observations keep the old alias while new observations resolve to the new alias

### Requirement: Ambiguity blocks actionable analysis
The system SHALL expose identity resolution confidence and candidates, and unresolved or conflicting identity MUST block instrument-specific recommendations and alerts.

#### Scenario: Ambiguous vendor mapping
- **WHEN** a provider symbol cannot be mapped uniquely to instrument plus MIC
- **THEN** the result is `UNRESOLVED`, candidates and provenance are retained, and no actionable signal is produced

### Requirement: Bounded bulk resolution
The system SHALL resolve watchlist/portfolio identifiers with a bounded batch or prefetch operation and MUST NOT perform one provider/network request per record.

#### Scenario: Portfolio with many listings
- **WHEN** a client requests context for a supported batch of listings
- **THEN** the backend validates the maximum batch size, uses provider bulk/prefetch where available and returns results in deterministic input order

