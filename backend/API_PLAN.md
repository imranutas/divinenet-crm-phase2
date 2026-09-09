# Campaign Management Backend API Plan

Jira: DCRM2-5  
Status: Sprint 2 implementation update  
Data: Testing data only

## Technology

- Node.js
- Express
- In-memory testing data for the current prototype
- Database persistence will be handled separately under DCRM2-13

## Campaign fields

Required fields:

- campaignName
- prompt
- startDate
- endDate
- channel

Optional fields:

- client
- brand
- objective
- targetAudience
- budget
- status

If status is not provided, the backend uses Draft.

## Supported platforms

- Facebook
- Instagram
- LinkedIn

## Supported statuses

- Draft
- Active
- Paused
- Completed

## Implemented API endpoints

- GET `/api/health`
- GET `/api/campaigns`
- GET `/api/campaigns/:id`
- POST `/api/campaigns`
- PUT `/api/campaigns/:id`
- DELETE `/api/campaigns/:id`

## Validation rules

- Campaign name is required.
- Prompt is required.
- Start date is required.
- End date is required.
- Channel is required.
- End date cannot be before the start date.
- Budget is optional.
- If budget is provided, it must be a number of zero or greater.
- Channel must be Facebook, Instagram or LinkedIn.
- Status is optional.
- If status is provided, it must be Draft, Active, Paused or Completed.

## Data and security

- Testing data is used during Sprint 2.
- No real customer information is used.
- No passwords or API keys are stored in the repository.
- No `.env` files are committed.
- No `node_modules` folder is committed.

## Current limitations

- Campaign data is stored temporarily in memory.
- Campaign data resets when the backend server restarts.
- Permanent database persistence is outside DCRM2-5.
- Frontend-to-backend integration is handled separately.
