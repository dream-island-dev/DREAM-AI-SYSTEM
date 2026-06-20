# Dream Island CRM & Automation - Roadmap

## Current Status (Locked)
- Core WhatsApp Pipeline and Webhook are stable.
- CRON jobs are safeguarded against spamming cancelled guests.
- UI unified (AddGuestModal).

## Up Next (Immediate Priorities)
1. **Resilient Import Agent (EZGO CSV):** Focus on Suites. Must auto-calculate `departure_date` based on arrival date + "number of nights" column.
2. **Pipeline Monitor Dashboard:** A visual UI to track the CRON queue, sent messages, and failed automations (using the SQL queries prepped in session 11).

## Future Vision (Backlog)
- **AI Shift Generator:** A smart engine to parse varied staff Excel schedules, manage hours, and export normalized reports.
