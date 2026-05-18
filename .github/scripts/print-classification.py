#!/usr/bin/env python3
"""Read classification JSON from file, print formatted output.

Usage: python3 print-classification.py <file>
"""
import json
import sys

filepath = sys.argv[1]
with open(filepath) as f:
    d = json.load(f)

print(f"Category: {d.get('category', '?')}")
print(f"Confidence: {d.get('confidence', 0)}%")
print(f"Transient: {d.get('transient', False)}")
print(f"Auto-fixable: {d.get('autoFixable', False)}")
print(f"Fix type: {d.get('fixType', '?')}")
print(f"Summary: {d.get('summary', '?')}")
