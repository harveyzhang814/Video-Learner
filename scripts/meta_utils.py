#!/usr/bin/env python3
"""Meta.json management utilities."""
import json
import os
from datetime import datetime

DEFAULT_META_FIELDS = {
    'url': '',
    'id': '',
    'ts': '',
    'title': '',
    'duration': '',
    'lang': 'auto',
    'download_status': 'pending',
    'download_attempts': 0,
    'download_error': '',
    'transcript_source': '',
    'transcript_done': False,
    'summary_done': False,
    'focus': '',
    'focus_needed': False,
    'claude_summary_pending': False,
    'tool_versions': {}
}

def create_meta(url, video_id, tool_versions):
    """Create a new meta.json structure."""
    meta = DEFAULT_META_FIELDS.copy()
    meta['url'] = url
    meta['id'] = video_id
    meta['ts'] = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    meta['tool_versions'] = tool_versions
    return meta

def load_meta(meta_path):
    """Load existing meta.json."""
    if os.path.exists(meta_path):
        with open(meta_path, 'r') as f:
            return json.load(f)
    return None

def save_meta(meta, meta_path):
    """Save meta to JSON file."""
    with open(meta_path, 'w') as f:
        json.dump(meta, f, indent=2)

def update_field(meta, field, value):
    """Update a single field in meta."""
    meta[field] = value
    return meta
