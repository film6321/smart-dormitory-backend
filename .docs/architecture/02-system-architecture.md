# 02. System Architecture

## High-Level Flow

Users
↓
Frontend
↓
Backend
↓
Face API
↓
OCR API
↓
Database

## Component Description

### Users

End users such as admins, residents, and visitors interact with the system through the web app.

### Frontend

Handles UI rendering, form input, API calls, and user interaction.

### Backend

Processes business logic, validates requests, and coordinates modules such as auth, billing, visitors, and OCR.

### Face API

External service used for face registration and face verification workflows.

### OCR API

External service used to process ID cards, slips, or other uploaded documents.

### Database

Stores core system data such as users, residents, rooms, visitors, bills, and verification records.
