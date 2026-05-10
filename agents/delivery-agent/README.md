# delivery-agent

Purpose: specialized business agent for the quotation-to-collection workflow.

## Input

JSON from API/n8n containing order, file, stage, and message context.

## Output

Structured JSON with:


action
status
message
next_stage
reminder_needed
escalation_level

## Implementation note

Start as an API function in \, then split into a separate service only when needed.
