# 🖥 Airgap Backend

The Airgap Backend provides the APIs required to prepare **offline development environments** for multiple package managers.

## Features
- **Job management** for archive generation (`ZIP` format)
- Downloads and bundles packages for:
  - **npm** (Node.js)
  - **pip** (Python)
  - **apt** (Linux system packages)
- **Version listing** for each package:
  - `GET /api/versions/npm?name=<pkg>`
  - `GET /api/versions/pip?name=<pkg>`
  - `GET /api/versions/apt?name=<pkg>&image=<distro>`
- **Artifact hosting** for completed jobs
- **Real-time job tracking**

> **Note:**  
> An **autocomplete API** exists in the backend but currently contains bugs.  
> The frontend does **not** use it yet.  
> Contributions to debug and improve it are welcome.

## Requirements
- **Redis** ≥ 6.2
- **Docker** installed (for Docker-based builds)
- Node.js ≥ 20

## Getting Started
```bash
cd airgap-backend
npm install
npm run dev
