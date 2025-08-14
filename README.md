📦 Backend – Airgap Backend

The backend provides the APIs required to prepare offline development environments.
It allows you to:

Manage a list of generation jobs for archives (ZIP) containing all required dependencies.

Download packages and dependencies for npm, pip, and apt, respecting the specified versions.

List available versions for a package (npm, pip, apt) via simple endpoints:

GET /api/versions/npm?name=<pkg>

GET /api/versions/pip?name=<pkg>

GET /api/versions/apt?name=<pkg>&image=<distro>

Provide artifacts (ready-to-deploy ZIP files) once a job is completed.

Track job status in real-time.

Note:
There is an autocomplete feature implemented in the backend, but it currently contains known bugs and is not actively used by the frontend.
Contributions to debug and improve it are welcome.