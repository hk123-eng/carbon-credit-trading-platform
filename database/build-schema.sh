#!/bin/bash
# Rebuilds schema.sql (complete fresh install) from the migration files.
cd "$(dirname "$0")"
{
  cat migrations/001_initial_schema.sql
  echo; echo
  cat migrations/002_review2.sql
  echo; echo
  cat migrations/seed_review2_demo.sql
} > schema.sql
echo "schema.sql rebuilt"
