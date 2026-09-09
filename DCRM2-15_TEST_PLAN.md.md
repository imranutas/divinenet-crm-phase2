# DCRM2-15 Sprint 2 Test Plan

**Owner:** Sushan (QA role)  
**Date:** 15 August 2026  
**Status:** Initial test plan and execution record  
**Test data:** Fictional data only

## Current test basis

- Repository: https://github.com/imranutas/divinenet-crm-phase2
- Backend branch: `sprint2/backend-api`
- Backend commit: `92b0ba4`
- Available endpoints:
  - `GET /api/health`
  - `GET /api/campaigns`
- Planned CRUD and integration tests remain blocked until the related features are supplied.

## Manual tests

| ID | Test | Expected result | QA status |
|---|---|---|---|
| TC-API-01 | Open `http://localhost:3000/api/health` | HTTP 200, `success: true`, API-running message | Not run |
| TC-API-02 | Open `http://localhost:3000/api/campaigns` | HTTP 200, `success: true`, fictional campaign array | Not run |
| TC-API-03 | Review all campaign response fields | No real customer data, password, token or API key | Not run |
| TC-API-04 | Open `http://localhost:3000/api/not-found` | HTTP 404; record the current error format | Not run |
| TC-API-05 | Request one campaign by ID | Correct campaign or clear not-found response | Blocked |
| TC-API-06 | Create a campaign with valid and invalid input | Valid input accepted; invalid input receives validation errors | Blocked |
| TC-API-07 | Update a campaign | Selected fictional campaign is updated | Blocked |
| TC-API-08 | Delete a campaign | Selected fictional campaign is removed | Blocked |
| TC-FE-01 | Open the existing Dashboard | Page and summary cards load correctly | Not run |
| TC-FE-02 | Open Campaign List | Existing fictional campaigns display | Not run |
| TC-FE-03 | Submit Create Campaign with required fields empty | Validation messages display and invalid data is not saved | Not run |
| TC-INT-01 | Test frontend/API connection | Frontend handles agreed JSON and success/error responses | Blocked |

## Evidence basis

Developer screenshots confirm that the endpoints were demonstrated. Independent QA results are recorded after separate execution with **Passed**, **Failed** or **Blocked** status and a dated supporting screenshot.

Use these filenames:

- `DCRM2-15_TC-API-01_health_15Aug2026.png`
- `DCRM2-15_TC-API-02_campaigns_15Aug2026.png`
- `DCRM2-15_TC-API-03_fictional-data_15Aug2026.png`
- `DCRM2-15_TC-API-04_unknown-route_15Aug2026.png`

## Completion criteria

The test record is complete when independent results, screenshots, defect records and applicable integration-test outcomes have been recorded.
