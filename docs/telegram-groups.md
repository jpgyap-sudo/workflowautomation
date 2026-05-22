# Telegram Groups

## Required groups

1. **Stage Transition Group** (`STAGE_TRANSITION_GROUP_CHAT_ID`) — receives a notification on **every** stage transition across all orders. This is the general progress group.
2. Purchasing Group — purchasing agent reminders
3. Production Group — production agent reminders
4. Inventory Arrival Group — inventory agent reminders
5. Delivery Group — delivery agent reminders
6. Collection Group — collection agent reminders
7. Escalation Group — escalation agent reminders

## Bot permissions

Add bot as admin or allow it to:

- read messages,
- read files/photos,
- send messages,
- mention users,
- optionally pin important reminders.

## Commands

```txt
/status QTN-2026-001
/produce QTN-2026-001 yes 10 days
/deliverydate QTN-2026-001 May 22 2026
/delivered QTN-2026-001 yes countered
/payment QTN-2026-001 confirmed
```

## Reminder escalation

```txt
Day 1: gentle reminder
Day 2: follow-up
Day 3: tag manager
Day 5: urgent escalation
```

## Stage transition notifications

When any order progresses to a new stage, the system sends a notification to the Stage Transition Group with the format:

```
📋 Stage Update — QTN-2026-001 (Client Name)
➡️ 📄 Production Confirmed
```

This is triggered automatically from `triggerAgentsForStage()` in `server.ts`, which is called by every endpoint that advances an order's stage.
