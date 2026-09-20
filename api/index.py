"""
Vercel Serverless Entrypoint for FlowShield API
===============================================
Exports the FastAPI application from server.py with project root appended to sys.path.
"""

import os
import sys

# Append project root directory to sys.path so engine and server modules are resolvable
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from server import app
