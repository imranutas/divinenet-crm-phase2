# DCRM2-5 Campaign Management Backend

## Overview

The campaign management backend is built using Node.js and Express for the Divinenet CRM Sprint 2 prototype.

Campaign data is currently stored temporarily in memory and resets whenever the server restarts.

## Setup

1. Open the backend folder.
2. Run `npm install`.
3. Run `node server.js`.
4. The API runs on port 3000.

## Required Campaign Fields

- campaignName
- prompt
- startDate
- endDate
- channel

## Optional Campaign Fields

- client
- brand
- objective
- targetAudience
- budget
- status

If status is not provided, the backend automatically uses Draft.

## Supported Platforms

- Facebook
- Instagram
- LinkedIn

## API Endpoints

- GET `/api/health`
- GET `/api/campaigns`
- GET `/api/campaigns/:id`
- POST `/api/campaigns`
- PUT `/api/campaigns/:id`
- DELETE `/api/campaigns/:id`

## Data and Security

- Testing data is used during Sprint 2.
- No real customer information is stored.
- No passwords or API keys are stored in GitHub.
- `.env` files are ignored.
- `node_modules` is ignored.

## Current Limitation

Campaign data is stored in memory and is not permanently saved. Database persistence will be handled separately under DCRM2-13.
