-- Migration 020: Add mime_type column to files table for local binary file storage
ALTER TABLE files ADD COLUMN IF NOT EXISTS mime_type TEXT;
