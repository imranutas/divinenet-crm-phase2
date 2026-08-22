# Campaign Management Backend API Plan

Jira: DCRM2-5  
Status: Implemented for Sprint 2 prototype  
Data: Testing data only

## Technology

- Node.js 24 LTS
- Express
- In-memory testing data
- Database connection will be completed separately under DCRM2-13

## Campaign Fields

- id
- campaignName
- client
- brand
- prompt
- objective
- targetAudience
- startDate
- endDate
- budget
- channel
- status

## Supported Channels

- Facebook
- Instagram
- LinkedIn

## Allowed Statuses

- Draft
- Active
- Paused
- Completed

## Implemented API Endpoints

### GET /api/health

Purpose: Confirm that the backend is running.

Successful response:

```json
{
  "success": true,
  "message": "Divinenet CRM API is running"
}
```

### GET /api/campaigns

Purpose: Return all campaigns.

### GET /api/campaigns/:id

Purpose: Return a campaign using its campaign ID.

If the campaign does not exist:

```json
{
  "success": false,
  "message": "Campaign not found"
}
```

### POST /api/campaigns

Purpose: Create a new campaign.

Required fields:

- campaignName
- client
- brand
- prompt
- objective
- targetAudience
- startDate
- endDate
- budget
- channel
- status

### PUT /api/campaigns/:id

Purpose: Update an existing campaign.

The endpoint supports partial updates while keeping the existing values for fields that are not provided.

### DELETE /api/campaigns/:id

Purpose: Delete an existing campaign.

Successful response:

```json
{
  "success": true,
  "message": "Campaign deleted successfully",
  "data": {}
}
```

## Validation Rules

- Campaign name is required.
- Client is required.
- Brand is required.
- Prompt is required.
- Objective is required.
- Target audience is required.
- Start date is required.
- End date is required.
- End date cannot be before the start date.
- Budget must be zero or greater.
- Channel must be Facebook, Instagram or LinkedIn.
- Status must be Draft, Active, Paused or Completed.
- Testing data only must be used.
- No real customer information, passwords or API keys should be included.

## Response Format

Successful response:

```json
{
  "success": true,
  "data": {}
}
```

Error response:

```json
{
  "success": false,
  "message": "Clear error explanation"
}
```

## Implementation Status

Completed:

- GET /api/health
- GET /api/campaigns
- GET /api/campaigns/:id
- POST /api/campaigns
- PUT /api/campaigns/:id
- DELETE /api/campaigns/:id
- Campaign validation
- Campaign prompt support
- Facebook support
- Instagram support
- LinkedIn support
- Unknown route handling

## Current Limitations

- Campaign records are currently stored in memory.
- Campaign data resets when the backend server restarts.
- Permanent database persistence is handled separately under DCRM2-13.
- Frontend-to-backend integration is not part of the current DCRM2-5 implementation.
- Live external API access is not currently enabled.
