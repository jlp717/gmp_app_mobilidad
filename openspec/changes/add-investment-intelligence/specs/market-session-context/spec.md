## ADDED Requirements

### Requirement: Canonical market session context
The system SHALL resolve a supported venue by operational MIC and return its IANA timezone, calendar date, trade date, normalized phase, current state, `asOf`, source freshness and next known transition as UTC instants.

#### Scenario: Normal XMAD continuous session
- **WHEN** a user requests XMAD during a verified normal continuous session
- **THEN** the system returns `OPEN`, phase `CONTINUOUS`, `Europe/Madrid`, the evidence timestamp and the next closing transition

#### Scenario: Client in another timezone
- **WHEN** the device timezone differs from the venue timezone
- **THEN** the backend keeps authoritative UTC and IANA values and the client renders the same instant in the user's timezone without changing the venue state

### Requirement: Effective-date schedule exceptions
The system SHALL apply versioned holidays, early closes, late opens, breaks and product or segment overrides before determining the current phase or next transition.

#### Scenario: BME early close
- **WHEN** XMAD has a verified early close on the requested session date
- **THEN** the returned close and alert transition use the exceptional time rather than the regular timetable

#### Scenario: Holiday
- **WHEN** the effective calendar marks the date as non-trading
- **THEN** the system returns `CLOSED`, identifies the holiday and returns the next verified opening transition

### Requirement: DST and cross-midnight correctness
The system SHALL derive offsets from an IANA timezone at the instant being evaluated and SHALL support sessions whose trade date differs from the local calendar date.

#### Scenario: Europe and United States change DST on different weeks
- **WHEN** a venue transition falls in a week with mismatched European and US DST rules
- **THEN** the UTC transition is calculated from each venue's IANA rules and does not reuse a fixed offset

#### Scenario: Session crosses midnight
- **WHEN** a supported session starts on one calendar day and belongs to the following trade date
- **THEN** the system preserves distinct calendar and trade dates and returns ordered UTC transitions

### Requirement: Operational and instrument overrides
The system SHALL treat scheduled phase, venue operational health and instrument halt/suspension as distinct inputs, and an authoritative halt or venue incident MUST override a scheduled `OPEN` state.

#### Scenario: Instrument halted during an open session
- **WHEN** the calendar says open but an authoritative source reports a halt for the instrument
- **THEN** the instrument context is `PAUSED` or `HALTED` and the system does not describe it as tradable

#### Scenario: Venue health unknown
- **WHEN** no current operational evidence exists beyond the planned calendar
- **THEN** the response distinguishes scheduled phase from operational state and includes an uncertainty warning

### Requirement: Safe status API
The system SHALL expose an authenticated, bounded and versionable market-state API with typed validation and safe uncertainty semantics.

#### Scenario: Invalid MIC syntax
- **WHEN** a request contains a MIC outside the accepted canonical format
- **THEN** the API returns HTTP 400 with code `INVALID_MIC` and a request ID

#### Scenario: Unsupported valid MIC
- **WHEN** a syntactically valid MIC is not in the supported universe
- **THEN** the API returns HTTP 404 with code `UNSUPPORTED_MIC`

#### Scenario: No reliable evidence
- **WHEN** a supported MIC cannot be resolved from fresh or permitted stale evidence
- **THEN** the API returns a successful domain response with state `UNKNOWN`, source/freshness metadata and a typed warning instead of guessing `CLOSED`

### Requirement: Explicit mobile states
The Flutter experience SHALL render loading, open, closed, pre/post session, degraded, unknown, error and offline states with venue timezone, next transition, source and freshness visible.

#### Scenario: Degraded cached response
- **WHEN** Flutter receives a `DEGRADED` market context
- **THEN** the UI shows the last `asOf` time, warning and manual refresh action and does not style it as live data

#### Scenario: Unknown response
- **WHEN** Flutter receives `UNKNOWN`
- **THEN** the UI states that availability cannot be verified and does not show a buy/sell call to action

