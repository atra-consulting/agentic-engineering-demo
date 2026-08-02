# Test Case: IMPORT-SOLUTION-JFS-2026

## Setup
- Start: `./start.sh`
- Stop: `Ctrl+C`
- URL: `http://localhost:7200`

## Scenarios

### 1. App boots and login works
- Navigate to: `http://localhost:7200`
- Action: Log in with `admin` / `admin123`
- Verify: dashboard page loads via `browser_snapshot`
- Expected: dashboard shows without errors, navbar/sidebar render

### 2. Core CRM list loads
- Navigate to: Firmen list (`/firmen` or the sidebar "Firmen" link)
- Action: none — just load the page
- Verify: `browser_snapshot` shows a populated table (seed data present)
- Expected: no console errors, table renders with rows
