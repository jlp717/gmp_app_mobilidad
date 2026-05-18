#!/usr/bin/env python3
"""Build context JSON from environment variables for failure reports.

Usage:
    export CTX_WORKFLOW="CI/CD Pipeline"
    export CTX_RUN_ID="12345"
    ...
    python3 build-context.py > /tmp/context.json
"""
import json
import os

ctx = {
    'workflow': os.environ.get('CTX_WORKFLOW', ''),
    'runId': os.environ.get('CTX_RUN_ID', ''),
    'runUrl': os.environ.get('CTX_RUN_URL', ''),
    'branch': os.environ.get('CTX_BRANCH', ''),
    'commitSha': os.environ.get('CTX_COMMIT_SHA', ''),
    'repoUrl': os.environ.get('CTX_REPO_URL', ''),
}

# failedJobs is optional and only used in some contexts
fj = os.environ.get('CTX_FAILED_JOBS')
if fj:
    try:
        ctx['failedJobs'] = json.loads(fj)
    except (json.JSONDecodeError, ValueError):
        ctx['failedJobs'] = fj

# Report-specific fields (optional)
for key in ['fixApplied', 'fixExitCode']:
    val = os.environ.get(f'CTX_{key.upper()}')
    if val is not None:
        ctx[key] = val

print(json.dumps(ctx))
