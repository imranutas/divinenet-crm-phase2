# DCRM2-5 Campaign Management Backend

## Overview

This backend supports the campaign management functions for the Divinenet CRM Sprint 2 prototype. It is built using Node.js and Express.

Campaign data is currently stored in memory using test data. The data resets when the server is restarted.

## Setup

1. Open the backend folder.
2. Run `npm install`.
3. Run `npm start`.
4. The server will run on port 3000.

## API Endpoints

- GET `/api/health`
- GET `/api/campaigns`
- GET `/api/campaigns/:id`
- POST `/api/campaigns`
- PUT `/api/campaigns/:id`
- DELETE `/api/campaigns/:id`

## Campaign Fields

A campaign contains:

- Campaign name
- Client
- Brand
- Objective
- Target audience
- Start date
- End date
- Budget
- Channel
- Status

The current supported channels are Facebook and Instagram.

## Validation

The backend checks required campaign fields, campaign dates, budget, channel and campaign status before accepting campaign data.

## Security

- Test data is used for development
- No real customer information is stored
- No passwords or API keys are included
- `.env` files are ignored
- `node_modules` is ignored

## Current Limitation

Campaign data is stored in memory and is not permanently saved. Database support will be handled separately as part of DCRM2-13.
