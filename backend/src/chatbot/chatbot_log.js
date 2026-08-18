'use strict';

const logger = require('../../middleware/logger');

const CHATBOT_LOG_EVENTS = Object.freeze({
  authorizationLookupFailed: 'CHATBOT_AUTHORIZATION_LOOKUP_FAILED',
  databaseQueryFailed: 'CHATBOT_DATABASE_QUERY_FAILED',
  handlerFailed: 'CHATBOT_HANDLER_FAILED',
  inputBlocked: 'CHATBOT_INPUT_BLOCKED',
  interaction: 'CHATBOT_INTERACTION',
  messageFailed: 'CHATBOT_MESSAGE_FAILED',
  outputCredentialBlocked: 'CHATBOT_OUTPUT_CREDENTIAL_BLOCKED',
  outputDatabaseDetailBlocked: 'CHATBOT_OUTPUT_DATABASE_DETAIL_BLOCKED',
  outputPromptBlocked: 'CHATBOT_OUTPUT_PROMPT_BLOCKED',
  outputSqlBlocked: 'CHATBOT_OUTPUT_SQL_BLOCKED',
  outputVendorScopeBlocked: 'CHATBOT_OUTPUT_VENDOR_SCOPE_BLOCKED',
  pdfExtractionFailed: 'CHATBOT_PDF_EXTRACTION_FAILED',
  topicBlocked: 'CHATBOT_TOPIC_BLOCKED',
});

const ALLOWED_EVENTS = new Set(Object.values(CHATBOT_LOG_EVENTS));
const ALLOWED_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const ALLOWED_BOOLEAN_METADATA = new Set([
  'llmUsed',
  'moderationBlocked',
]);
const ALLOWED_NUMERIC_METADATA = new Set([
  'messageLength',
  'responseLength',
  'toolCallCount',
]);

function allowlistedMetadata(metadata) {
  const safe = {};
  if (!metadata || typeof metadata !== 'object') return safe;
  for (const [key, value] of Object.entries(metadata)) {
    if (ALLOWED_BOOLEAN_METADATA.has(key) && typeof value === 'boolean') {
      safe[key] = value;
    }
    if (ALLOWED_NUMERIC_METADATA.has(key)
      && Number.isSafeInteger(value)
      && value >= 0) {
      safe[key] = value;
    }
  }
  return safe;
}

function emitChatbotLog(level, event, metadata = null) {
  const safeLevel = ALLOWED_LEVELS.has(level) ? level : 'warn';
  const safeEvent = ALLOWED_EVENTS.has(event)
    ? event
    : CHATBOT_LOG_EVENTS.handlerFailed;
  const safeMetadata = allowlistedMetadata(metadata);
  if (Object.keys(safeMetadata).length === 0) {
    logger[safeLevel](safeEvent);
    return;
  }
  logger[safeLevel](safeEvent, safeMetadata);
}

module.exports = {
  CHATBOT_LOG_EVENTS,
  emitChatbotLog,
};
