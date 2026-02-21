# Personal Secretary

Personal Secretary is a rule-driven assistant built on top of Google Calendar.  
It transforms simple calendar events into structured, actionable tasks.  
Implement LLM for classify event and generate task.

Instead of acting as a passive reminder system, it behaves like a digital secretary — helping you prepare, execute, and follow up on what you schedule.

This project focuses on clarity, intent, and task lifecycle management rather than automation for its own sake.

## Core Idea

A calendar event is not a task.  
When users create an event, they usually record an intention, not a complete action plan.

Example:

- “Submit tax”
- “Side project”
- “Doctor appointment”
- “Workout”

Traditional calendars only store time.

Personal Secretary:

1. Normalizes event data
2. Categorizes event structure
3. Determines task intent
4. Generates structured draft tasks
5. Tracks task lifecycle
6. Adapts based on feedback

The system is rule-based and deterministic.
LLM is used only as a bounded helper for interpretation or task breakdown — never as the core decision engine.

## Current Plan (In progress)

- Fetch calendar event
- Structural categorization design
- Rule-based classify event
- LLM classify event
- Task system design
- Event shift handling concept
- Task Generate by topic

This phase focuses on strong architecture before automation.
